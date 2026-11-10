import {
  type Experiment,
  type ExperimentTemplate as AwsExperimentTemplate,
  type ExperimentTemplateStopCondition,
  type ExperimentTemplateTarget,
  FisClient,
  GetExperimentCommand,
  GetExperimentTemplateCommand,
  paginateListExperimentResolvedTargets,
  paginateListExperimentTemplates,
  ListExperimentsCommand,
  StartExperimentCommand,
  StopExperimentCommand,
} from '@aws-sdk/client-fis';
import {
  EXPERIMENT_STATES,
  type ExperimentState,
  type ExperimentStep,
  type ExperimentSummary,
  type ExperimentTarget,
  type ExperimentTemplate,
} from '@pulsegrid/shared';
import type { ExperimentContext, ExperimentRecord, ExperimentSource } from '../provider';
import { isAccessDenied } from './aws-error-messages';
import type { AwsKey } from './aws-key';

const TEMPLATE_LIMIT = 25;
const EXPERIMENT_LIMIT = 20;
const ALARM_SOURCE = 'aws:cloudwatch:alarm';
const NAME_TAG = 'Name';
const ARN_PREFIX = 'arn:';
const NOT_FOUND = 'ResourceNotFoundException';

const MESSAGES: Record<string, string> = {
  ConflictException: "AWS can't do that in the experiment's current state.",
  ServiceQuotaExceededException: 'This account is already running as many experiments as AWS allows.',
  ValidationException: "AWS refused this experiment. Check the template's targets and role in the FIS console.",
  ResourceNotFoundException: 'That experiment or template no longer exists in AWS.',
};
const NO_PERMISSION = "This key can't do that. Add the FIS permissions from Integrations to its IAM policy.";
const FAILED = "AWS couldn't complete that. Please try again.";

const client = ({ credentials, region }: ExperimentContext<AwsKey>): FisClient =>
  new FisClient({ region, credentials });

const iso = (date: Date | undefined): string | null => date?.toISOString() ?? null;

const toState = (status: string | undefined): ExperimentState =>
  EXPERIMENT_STATES.find((state) => state === status) ?? 'pending';

const labelOf = (id: string, tags: Record<string, string> | undefined, description: string | undefined): string =>
  tags?.[NAME_TAG] ?? description ?? id;

const selectionMode = (mode: string | undefined): string => {
  const [, kind, amount] = /^(ALL|COUNT|PERCENT)(?:\((\d+)\))?$/.exec(mode ?? '') ?? [];
  if (kind === 'COUNT') {
    return `, ${amount} of them`;
  }
  return kind === 'PERCENT' ? `, ${amount}% of them` : '';
};

const selectionOf = ({ resourceArns, resourceTags, filters, selectionMode: mode }: ExperimentTemplateTarget): string => {
  const parts = [
    ...(resourceArns?.length ? [`${resourceArns.length} listed resource${resourceArns.length === 1 ? '' : 's'}`] : []),
    ...(resourceTags && Object.keys(resourceTags).length > 0
      ? [`tagged ${Object.entries(resourceTags).map(([key, value]) => `${key}=${value}`).join(', ')}`]
      : []),
    ...(filters?.length ? ['filtered'] : []),
  ];
  return `${parts.join(', ') || 'chosen by AWS'}${selectionMode(mode)}`;
};

const targetsOf = (targets: Record<string, ExperimentTemplateTarget> | undefined): ExperimentTarget[] =>
  Object.entries(targets ?? {}).map(([name, target]) => ({
    name,
    resourceType: target.resourceType ?? '',
    selection: selectionOf(target),
    resourceIds: target.resourceArns ?? [],
  }));

const stepsOf = (
  actions: Record<string, { actionId?: string; description?: string; parameters?: Record<string, string> }> | undefined,
): ExperimentStep[] =>
  Object.entries(actions ?? {}).map(([name, action]) => ({
    name,
    actionId: action.actionId ?? '',
    description: action.description ?? null,
    duration: action.parameters?.['duration'] ?? null,
  }));

const alarmsOf = (conditions: readonly ExperimentTemplateStopCondition[] | undefined): string[] =>
  (conditions ?? [])
    .filter(({ source }) => source === ALARM_SOURCE)
    .map(({ value }) => value?.split(':alarm:').at(-1) ?? value ?? '');

const toTemplate = (template: AwsExperimentTemplate, region: string): ExperimentTemplate => {
  const id = template.id ?? '';
  return {
    id,
    region,
    label: labelOf(id, template.tags, template.description),
    description: template.description ?? null,
    targets: targetsOf(template.targets),
    steps: stepsOf(template.actions),
    stopAlarms: alarmsOf(template.stopConditions),
  };
};

const templateInfo = async (
  fis: FisClient,
  templateId: string,
): Promise<{ label: string; description: string | null }> => {
  try {
    const { experimentTemplate } = await fis.send(new GetExperimentTemplateCommand({ id: templateId }));
    return {
      label: labelOf(templateId, experimentTemplate?.tags, experimentTemplate?.description),
      description: experimentTemplate?.description ?? null,
    };
  } catch (error) {
    if ((error as Error).name === NOT_FOUND) {
      return { label: templateId, description: null };
    }
    throw error;
  }
};

const resolvedIds = async (fis: FisClient, experimentId: string): Promise<string[]> => {
  const ids: string[] = [];
  for await (const page of paginateListExperimentResolvedTargets({ client: fis }, { experimentId })) {
    for (const { targetInformation } of page.resolvedTargets ?? []) {
      ids.push(...Object.values(targetInformation ?? {}).filter((value) => value.startsWith(ARN_PREFIX)));
    }
  }
  return ids;
};

const toRecord = async (fis: FisClient, experiment: Experiment, region: string): Promise<ExperimentRecord> => {
  const id = experiment.id ?? '';
  const templateId = experiment.experimentTemplateId ?? '';
  return {
    id,
    region,
    templateId,
    ...(await templateInfo(fis, templateId)),
    state: toState(experiment.state?.status),
    reason: experiment.state?.reason ?? null,
    startedAt: iso(experiment.startTime ?? experiment.creationTime),
    endedAt: iso(experiment.endTime),
    steps: Object.entries(experiment.actions ?? {}).map(([name, action]) => ({
      ...stepsOf({ [name]: action })[0]!,
      state: action.state?.status ?? 'pending',
      reason: action.state?.reason ?? null,
      startedAt: iso(action.startTime),
      endedAt: iso(action.endTime),
    })),
    targets: targetsOf(experiment.targets),
    stopAlarms: alarmsOf(experiment.stopConditions),
    resolvedResourceIds: await resolvedIds(fis, id),
  };
};

export const AWS_EXPERIMENT_SOURCE: ExperimentSource<AwsKey> = {
  listTemplates: async (context) => {
    const fis = client(context);
    const ids: string[] = [];
    for await (const page of paginateListExperimentTemplates({ client: fis }, {})) {
      ids.push(...(page.experimentTemplates ?? []).flatMap(({ id }) => id ?? []));
      if (ids.length >= TEMPLATE_LIMIT) {
        break;
      }
    }
    const templates = await Promise.all(
      ids.slice(0, TEMPLATE_LIMIT).map((id) => fis.send(new GetExperimentTemplateCommand({ id }))),
    );
    return templates.flatMap(({ experimentTemplate }) =>
      experimentTemplate ? [toTemplate(experimentTemplate, context.region)] : [],
    );
  },

  listExperiments: async (context): Promise<ExperimentSummary[]> => {
    const { experiments = [] } = await client(context).send(new ListExperimentsCommand({ maxResults: EXPERIMENT_LIMIT }));
    return experiments.map((experiment) => {
      const id = experiment.id ?? '';
      const templateId = experiment.experimentTemplateId ?? '';
      return {
        id,
        region: context.region,
        templateId,
        label: templateId,
        state: toState(experiment.state?.status),
        reason: experiment.state?.reason ?? null,
        startedAt: iso(experiment.creationTime),
        endedAt: null,
      };
    });
  },

  getExperiment: async (context, id) => {
    const fis = client(context);
    try {
      const { experiment } = await fis.send(new GetExperimentCommand({ id }));
      return experiment ? await toRecord(fis, experiment, context.region) : null;
    } catch (error) {
      if ((error as Error).name === NOT_FOUND) {
        return null;
      }
      throw error;
    }
  },

  start: async (context, templateId, requestToken) => {
    const { experiment } = await client(context).send(
      new StartExperimentCommand({ experimentTemplateId: templateId, clientToken: requestToken }),
    );
    return experiment?.id ?? '';
  },

  stop: async (context, id) => {
    await client(context).send(new StopExperimentCommand({ id }));
  },

  failureMessage: (error) => {
    if (isAccessDenied(error)) {
      return NO_PERMISSION;
    }
    return MESSAGES[(error as { name?: string }).name ?? ''] ?? FAILED;
  },
};
