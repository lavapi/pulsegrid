import {
  isActivePipelineStatus,
  type PipelineDefinition,
  type PipelineRun,
  type PipelineSummary,
} from '@pulsegrid/shared';
import { detectEnvironment, isKnownNonProductionName, isProductionName } from '../inventory/environments/environment-detection';
import type { GitWorkflow } from './git/git-provider';

export interface PipelineLink {
  repository: string;
  workflowId: string;
  environmentId: string | null;
}

export interface EnvironmentRef {
  id: string;
  name: string;
}

export interface PipelineContext {
  appId: string;
  workflow: GitWorkflow;
  definition: PipelineDefinition | null;
  links: readonly PipelineLink[];
  environments: readonly EnvironmentRef[];
}

export interface Protection {
  production: boolean;
  label: string;
}

export interface ProtectionTarget {
  branch?: string | undefined;
  environment?: EnvironmentRef | null | undefined;
}

const sameName = (first: string, second: string): boolean =>
  first.toLowerCase() === second.toLowerCase();

const named = (
  environments: readonly EnvironmentRef[],
  name: string,
): EnvironmentRef | undefined => environments.find((item) => sameName(item.name, name));

const environmentNameForBranch = (context: PipelineContext, branch: string): string | null => {
  const rule = context.definition?.environmentRule;
  if (!rule) {
    return null;
  }
  return branch === rule.branch ? rule.matched : rule.otherwise;
};

const fixedEnvironment = (context: PipelineContext): EnvironmentRef | null => {
  const { workflow, definition, links, environments } = context;
  const link = links.find(
    ({ repository, workflowId }) =>
      repository === workflow.repository && workflowId === workflow.id,
  );
  if (link) {
    return environments.find(({ id }) => id === link.environmentId) ?? null;
  }
  const fromFile = (definition?.environments ?? []).flatMap((name) => named(environments, name) ?? []);
  const detected = detectEnvironment(workflow.name)?.name;
  return (
    fromFile.find(({ name }) => isProductionName(name)) ??
    fromFile[0] ??
    environments.find(({ name }) => name === detected) ??
    null
  );
};

export const pipelineEnvironments = (context: PipelineContext): EnvironmentRef[] => {
  const rule = context.definition?.environmentRule;
  if (rule) {
    return [rule.matched, rule.otherwise].flatMap((name) => named(context.environments, name) ?? []);
  }
  const environment = fixedEnvironment(context);
  return environment ? [environment] : [];
};

const runBelongsTo = (
  context: PipelineContext,
  run: PipelineRun,
  environment: EnvironmentRef,
): boolean => {
  const name = environmentNameForBranch(context, run.branch);
  return name === null || sameName(name, environment.name);
};

export const runsFor = (
  context: PipelineContext,
  runs: readonly PipelineRun[],
  environment: EnvironmentRef | null | undefined,
): PipelineRun[] =>
  environment ? runs.filter((run) => runBelongsTo(context, run, environment)) : [...runs];

export const environmentOfRun = (context: PipelineContext, run: PipelineRun): string | null => {
  const name = environmentNameForBranch(context, run.branch);
  if (name === null) {
    return pipelineEnvironments(context)[0]?.name ?? null;
  }
  return named(context.environments, name)?.name ?? name;
};

export const branchForEnvironment = (
  { environmentRule: rule }: PipelineDefinition,
  environment: EnvironmentRef,
): string | null => (rule && sameName(rule.matched, environment.name) ? rule.branch : null);

const routedProtection = (context: PipelineContext, target: ProtectionTarget): Protection => {
  const { workflow, definition } = context;
  const rule = definition?.environmentRule;
  const name =
    target.branch !== undefined
      ? environmentNameForBranch(context, target.branch)
      : (target.environment?.name ?? null);
  if (!rule || name === null) {
    const production = [rule?.matched, rule?.otherwise].find((item) => item && isProductionName(item));
    return { production: true, label: production ?? workflow.name };
  }
  const environment = named(context.environments, name);
  return { production: !isKnownNonProductionName(name), label: environment?.name ?? name };
};

export const protectionFor = (
  context: PipelineContext,
  target: ProtectionTarget = {},
): Protection => {
  const { workflow, definition } = context;
  if (definition?.environmentRule) {
    return routedProtection(context, target);
  }
  if (definition?.opaqueEnvironment) {
    return { production: true, label: workflow.name };
  }
  const environment = fixedEnvironment(context);
  const production =
    !environment ||
    !isKnownNonProductionName(environment.name) ||
    (definition?.environments ?? []).some(isProductionName);
  return { production, label: environment?.name ?? workflow.name };
};

const latestRunFor = (workflow: GitWorkflow, runs: readonly PipelineRun[]): PipelineRun | null =>
  runs.find(({ workflowId }) => workflowId === workflow.id) ?? null;

export const toPipelineSummary = (
  context: PipelineContext,
  runs: readonly PipelineRun[],
  scope?: EnvironmentRef | null,
): PipelineSummary => {
  const { workflow, definition } = context;
  const environments = pipelineEnvironments(context);
  const routed = Boolean(definition?.environmentRule);
  const scoped = routed ? environments.find(({ id }) => id === scope?.id) : undefined;
  const primary =
    scoped ?? environments.find(({ name }) => isProductionName(name)) ?? environments[0] ?? null;
  return {
    appId: context.appId,
    repository: workflow.repository,
    workflowId: workflow.id,
    name: workflow.name,
    path: workflow.path,
    url: workflow.url,
    latestRun: latestRunFor(workflow, runsFor(context, runs, scoped)),
    environmentId: primary?.id ?? null,
    environmentName: primary?.name ?? null,
    environmentIds: environments.map(({ id }) => id),
    branchRouted: routed,
    production: protectionFor(context, { environment: scoped }).production,
  };
};

const rank = ({ latestRun }: PipelineSummary): number => {
  if (!latestRun) {
    return 3;
  }
  if (isActivePipelineStatus(latestRun.status)) {
    return 0;
  }
  return latestRun.status === 'failure' ? 1 : 2;
};

const startedAt = ({ latestRun }: PipelineSummary): string => latestRun?.startedAt ?? '';

export const sortPipelines = (pipelines: readonly PipelineSummary[]): PipelineSummary[] =>
  [...pipelines].sort(
    (first, second) =>
      rank(first) - rank(second) || startedAt(second).localeCompare(startedAt(first)),
  );
