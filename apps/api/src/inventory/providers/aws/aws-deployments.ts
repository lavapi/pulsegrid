import {
  type Deployment as EcsDeployment,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ECSClient,
} from '@aws-sdk/client-ecs';
import type { Deployment, DeploymentSource, DeploymentState } from '../provider';
import type { AwsKey } from './aws-key';

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

export const AWS_DEPLOYMENT_SOURCE: DeploymentSource<AwsKey> = {
  resourceType: 'ecs-service',
  read: async ({ credentials, region, resource }): Promise<Deployment | null> => {
    const client = new ECSClient({ region, credentials });
    const { services = [] } = await client.send(
      new DescribeServicesCommand({
        cluster: resource.details['cluster'] as string,
        services: [resource.nativeId],
      }),
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
    };
  },
};
