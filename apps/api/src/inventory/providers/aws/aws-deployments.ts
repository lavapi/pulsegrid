import {
  type Deployment as EcsDeployment,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ECSClient,
} from '@aws-sdk/client-ecs';
import {
  isActiveTrafficDeployment,
  isUnsuccessfulTrafficDeployment,
  type ServiceDeploymentsView,
  type TrafficDeployment,
} from '@pulsegrid/shared';
import type { Deployment, DeploymentSource, DeploymentState, ResourceActionContext } from '../provider';
import { isAccessDenied } from './aws-error-messages';
import type { AwsKey } from './aws-key';
import { readTrafficDeployments, strategyOf } from './aws-service-deployments';

const NO_PERMISSION =
  "This key can't read blue/green deployments. Add ecs:ListServiceDeployments, ecs:DescribeServiceDeployments and ecs:DescribeServiceRevisions to its IAM policy.";
const READ_FAILED = "We couldn't read the deployments from AWS. Please try again.";
const STRATEGY_LABELS = { 'blue-green': 'blue/green', canary: 'canary', linear: 'linear' } as const;

const PRIMARY = 'PRIMARY';
const ROLLOUT_STATES: Record<string, DeploymentState> = {
  IN_PROGRESS: 'running',
  COMPLETED: 'succeeded',
  FAILED: 'failed',
};

const stateOf = (primary: EcsDeployment, deployments: number): DeploymentState => {
  const known = primary.rolloutState && ROLLOUT_STATES[primary.rolloutState];
  if (known) {
    return known;
  }
  const settled = deployments === 1 && (primary.runningCount ?? 0) >= (primary.desiredCount ?? 0);
  return settled ? 'succeeded' : 'running';
};

const targetLabel = (launchType: unknown): string =>
  typeof launchType === 'string' && /fargate/i.test(launchType) ? 'ECS Fargate' : 'ECS';

const trafficState = ({ status }: TrafficDeployment): DeploymentState => {
  if (isActiveTrafficDeployment(status)) {
    return 'running';
  }
  return isUnsuccessfulTrafficDeployment(status) ? 'failed' : 'succeeded';
};

const fromTraffic = (deployment: TrafficDeployment, launchType: unknown): Deployment => ({
  state: trafficState(deployment),
  startedAt: deployment.startedAt,
  finishedAt: deployment.finishedAt,
  runningTasks: deployment.green?.runningTasks ?? 0,
  desiredTasks: deployment.green?.requestedTasks ?? 0,
  images: deployment.green?.images ?? [],
  targetLabel: `${targetLabel(launchType)} ${STRATEGY_LABELS[deployment.strategy]}`,
  traffic: {
    stage: deployment.stage,
    status: deployment.status,
    reason: deployment.reason,
    rollbackReason: deployment.rollbackReason,
    updatedAt: deployment.updatedAt,
  },
});

const clusterOf = ({ resource }: ResourceActionContext<AwsKey>): string => resource.details['cluster'] as string;

const readRolling = async (client: ECSClient, context: ResourceActionContext<AwsKey>): Promise<Deployment | null> => {
  const { resource } = context;
  const { services = [] } = await client.send(
    new DescribeServicesCommand({ cluster: clusterOf(context), services: [resource.nativeId] }),
  );
  const deployments = services[0]?.deployments ?? [];
  const primary = deployments.find(({ status }) => status === PRIMARY);
  if (!primary) {
    return null;
  }
  const { taskDefinition } = await client.send(
    new DescribeTaskDefinitionCommand({ taskDefinition: primary.taskDefinition }),
  );
  const state = stateOf(primary, deployments.length);
  return {
    state,
    startedAt: primary.createdAt?.toISOString() ?? null,
    finishedAt: state === 'running' ? null : (primary.updatedAt?.toISOString() ?? null),
    runningTasks: primary.runningCount ?? 0,
    desiredTasks: primary.desiredCount ?? 0,
    images: (taskDefinition?.containerDefinitions ?? []).flatMap(({ image }) => image ?? []),
    targetLabel: targetLabel(resource.details['launchType']),
    traffic: null,
  };
};

export const AWS_DEPLOYMENT_SOURCE: DeploymentSource<AwsKey> = {
  resourceType: 'ecs-service',

  /** The latest deployment, for Releases. Blue/green services fall back to the rolling view if the key can't read them. */
  read: async (context): Promise<Deployment | null> => {
    const client = new ECSClient({ region: context.region, credentials: context.credentials });
    const { resource } = context;
    if (strategyOf(resource.details['deploymentStrategy']) !== 'rolling') {
      try {
        const [latest] = await readTrafficDeployments(client, clusterOf(context), resource.nativeId, 1);
        if (latest) {
          return fromTraffic(latest, resource.details['launchType']);
        }
      } catch (error) {
        if (!isAccessDenied(error)) {
          throw error;
        }
      }
    }
    return readRolling(client, context);
  },

  recent: async (context, limit): Promise<ServiceDeploymentsView> => {
    const strategy = strategyOf(context.resource.details['deploymentStrategy']);
    if (strategy === 'rolling') {
      return { strategy, deployments: [], error: null };
    }
    const client = new ECSClient({ region: context.region, credentials: context.credentials });
    const deployments = await readTrafficDeployments(client, clusterOf(context), context.resource.nativeId, limit);
    return { strategy, deployments, error: null };
  },

  failureMessage: (error) => (isAccessDenied(error) ? NO_PERMISSION : READ_FAILED),
};
