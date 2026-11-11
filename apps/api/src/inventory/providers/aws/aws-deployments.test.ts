import {
  DescribeServiceDeploymentsCommand,
  DescribeServiceRevisionsCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  ECSClient,
  ListServiceDeploymentsCommand,
} from '@aws-sdk/client-ecs';
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
      traffic: null,
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

describe('ECS blue/green deployments', () => {
  const blueGreen = { ...context, resource: { ...context.resource, details: { ...context.resource.details, deploymentStrategy: 'BLUE_GREEN' } } };
  const serviceDeployment = {
    serviceDeploymentArn: 'arn:aws:ecs:eu-central-1:1:service-deployment/main/api/dep-2',
    createdAt,
    startedAt: createdAt,
    updatedAt,
    status: 'IN_PROGRESS' as const,
    lifecycleStage: 'POST_TEST_TRAFFIC_SHIFT' as const,
    sourceServiceRevisions: [{ arn: 'arn:rev/blue-1', runningTaskCount: 3, requestedTaskCount: 3, requestedProductionTrafficWeight: 100 }],
    targetServiceRevision: { arn: 'arn:rev/green-2', runningTaskCount: 3, requestedTaskCount: 3, requestedTestTrafficWeight: 100 },
    deploymentConfiguration: {
      strategy: 'BLUE_GREEN' as const,
      bakeTimeInMinutes: 10,
      lifecycleHooks: [{ hookTargetArn: 'arn:lambda', lifecycleStages: ['POST_TEST_TRAFFIC_SHIFT' as const] }],
    },
  };

  beforeEach(() => {
    ecs.reset();
    ecs.on(ListServiceDeploymentsCommand).resolves({
      serviceDeployments: [{ serviceDeploymentArn: serviceDeployment.serviceDeploymentArn }],
    });
    ecs.on(DescribeServiceDeploymentsCommand).resolves({ serviceDeployments: [serviceDeployment] });
    ecs.on(DescribeServiceRevisionsCommand).resolves({
      serviceRevisions: [
        { serviceRevisionArn: 'arn:rev/blue-1', taskDefinition: 'arn:task-definition/api:6', containerImages: [{ image: 'repo/api:old1234' }] },
        { serviceRevisionArn: 'arn:rev/green-2', taskDefinition: 'arn:task-definition/api:7', containerImages: [{ image: 'repo/api:abc1234' }] },
      ],
    });
  });

  it('shows blue, green, the stage and the hooks', async () => {
    const view = await AWS_DEPLOYMENT_SOURCE.recent(blueGreen, 5);
    expect(view.strategy).toBe('blue-green');
    expect(view.deployments[0]).toMatchObject({
      id: 'dep-2',
      strategy: 'blue-green',
      status: 'in-progress',
      stage: 'test-traffic',
      bakeTimeMinutes: 10,
      hookStages: ['test-traffic'],
      blue: { revision: 'blue-1', taskDefinition: 'api:6', images: ['repo/api:old1234'], productionTrafficPercent: 100 },
      green: { revision: 'green-2', taskDefinition: 'api:7', images: ['repo/api:abc1234'], testTrafficPercent: 100 },
    });
  });

  it('gives Releases the green images and the traffic stage', async () => {
    expect(await AWS_DEPLOYMENT_SOURCE.read(blueGreen)).toMatchObject({
      state: 'running',
      images: ['repo/api:abc1234'],
      targetLabel: 'ECS Fargate blue/green',
      traffic: { stage: 'test-traffic', status: 'in-progress' },
    });
  });

  it('reports a rollback as failed with its reason', async () => {
    ecs.on(DescribeServiceDeploymentsCommand).resolves({
      serviceDeployments: [{ ...serviceDeployment, status: 'ROLLBACK_SUCCESSFUL', rollback: { reason: 'Alarm fired' } }],
    });
    expect(await AWS_DEPLOYMENT_SOURCE.read(blueGreen)).toMatchObject({
      state: 'failed',
      traffic: { status: 'rolled-back', rollbackReason: 'Alarm fired' },
    });
  });

  it('falls back to the rolling view when the key cannot read service deployments', async () => {
    ecs.on(ListServiceDeploymentsCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDeniedException' }));
    ecs.on(DescribeServicesCommand).resolves({ services: [{ deployments: [primary] }] });
    ecs.on(DescribeTaskDefinitionCommand).resolves({ taskDefinition: { containerDefinitions: [{ image: 'repo/api:abc1234' }] } });
    expect(await AWS_DEPLOYMENT_SOURCE.read(blueGreen)).toMatchObject({ state: 'running', traffic: null });
    expect(AWS_DEPLOYMENT_SOURCE.failureMessage(Object.assign(new Error('no'), { name: 'AccessDeniedException' }))).toContain(
      'ecs:ListServiceDeployments',
    );
  });

  it('shows nothing extra for rolling services', async () => {
    expect(await AWS_DEPLOYMENT_SOURCE.recent(context, 5)).toEqual({ strategy: 'rolling', deployments: [], error: null });
    expect(ecs.commandCalls(ListServiceDeploymentsCommand)).toHaveLength(0);
  });
});
