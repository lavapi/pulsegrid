import { DescribeServicesCommand, DescribeTaskDefinitionCommand, ECSClient } from '@aws-sdk/client-ecs';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { AWS_DEPLOYMENT_SOURCE } from './aws-deployments';

const ecs = mockClient(ECSClient);
const context = {
  credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
  region: 'eu-central-1',
  resource: {
    nativeId: 'arn:service',
    name: 'api',
    details: { cluster: 'main', launchType: 'FARGATE' },
  },
};
const createdAt = new Date('2026-11-06T10:00:00Z');
const updatedAt = new Date('2026-11-06T10:05:00Z');
const primary = {
  status: 'PRIMARY',
  taskDefinition: 'api:7',
  rolloutState: 'IN_PROGRESS' as const,
  runningCount: 2,
  desiredCount: 3,
  createdAt,
  updatedAt,
};
const withDeployments = (deployments: object[]) =>
  ecs.on(DescribeServicesCommand).resolves({ services: [{ deployments }] });

describe('ECS rollouts', () => {
  beforeEach(() => {
    ecs.reset();
    ecs.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: { containerDefinitions: [{ image: 'repo/api:abc1234' }, {}] },
    });
  });

  it('reports a rollout in progress with its image and tasks', async () => {
    withDeployments([{ ...primary }, { status: 'ACTIVE' }]);
    expect(await AWS_DEPLOYMENT_SOURCE.read(context)).toEqual({
      state: 'running',
      startedAt: createdAt.toISOString(),
      finishedAt: null,
      runningTasks: 2,
      desiredTasks: 3,
      images: ['repo/api:abc1234'],
      targetLabel: 'ECS Fargate',
    });
    expect(ecs.commandCalls(DescribeTaskDefinitionCommand)[0]!.args[0].input.taskDefinition).toBe('api:7');
  });

  it('marks finished and failed rollouts', async () => {
    withDeployments([{ ...primary, rolloutState: 'COMPLETED' }]);
    expect(await AWS_DEPLOYMENT_SOURCE.read(context)).toMatchObject({
      state: 'succeeded',
      finishedAt: updatedAt.toISOString(),
    });
    withDeployments([{ ...primary, rolloutState: 'FAILED' }]);
    expect(await AWS_DEPLOYMENT_SOURCE.read(context)).toMatchObject({ state: 'failed' });
  });

  it('falls back to task counts when AWS gives no rollout state', async () => {
    const plain = { ...primary, rolloutState: undefined };
    withDeployments([{ ...plain, runningCount: 3 }]);
    expect(await AWS_DEPLOYMENT_SOURCE.read(context)).toMatchObject({ state: 'succeeded' });
    withDeployments([{ ...plain, runningCount: 3 }, { status: 'ACTIVE' }]);
    expect(await AWS_DEPLOYMENT_SOURCE.read(context)).toMatchObject({ state: 'running' });
  });

  it('names plain ECS services, and handles a service with no rollout', async () => {
    withDeployments([primary]);
    const onServers = { ...context, resource: { ...context.resource, details: { cluster: 'main' } } };
    expect(await AWS_DEPLOYMENT_SOURCE.read(onServers)).toMatchObject({ targetLabel: 'ECS' });
    withDeployments([]);
    expect(await AWS_DEPLOYMENT_SOURCE.read(context)).toBeNull();
  });
});
