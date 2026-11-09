import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { DescribeTaskDefinitionCommand, ECSClient } from '@aws-sdk/client-ecs';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { AWS_LOG_SOURCE } from './aws-logs';

const logs = mockClient(CloudWatchLogsClient);
const ecs = mockClient(ECSClient);
const until = new Date('2026-11-06T12:00:00Z');
const since = new Date('2026-11-06T11:45:00Z');
const context = {
  credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
  region: 'eu-central-1',
  resource: { nativeId: 'arn', name: 'api', details: { taskDefinition: 'api:4' } },
};

const withLogGroup = () =>
  ecs.on(DescribeTaskDefinitionCommand).resolves({
    taskDefinition: {
      containerDefinitions: [
        { name: 'sidecar' },
        {
          name: 'app',
          logConfiguration: {
            logDriver: 'awslogs',
            options: { 'awslogs-group': '/ecs/api', 'awslogs-stream-prefix': 'app' },
          },
        },
      ],
    },
  });

beforeEach(() => {
  logs.reset();
  ecs.reset();
});

describe('AWS_LOG_SOURCE', () => {
  it('finds the log group and reads lines oldest first', async () => {
    withLogGroup();
    logs
      .on(FilterLogEventsCommand)
      .resolvesOnce({
        events: [{ eventId: '2', timestamp: until.getTime() - 1000, logStreamName: 's', message: 'new' }],
      })
      .resolves({
        events: [{ eventId: '1', timestamp: until.getTime() - 400000, logStreamName: 's', message: 'old' }],
      });
    const result = await AWS_LOG_SOURCE.read(context, { since, until });
    expect(result.lines.map(({ message }) => message)).toEqual(['old', 'new']);
    expect(logs.commandCalls(FilterLogEventsCommand)[0]?.args[0].input).toMatchObject({
      logGroupName: '/ecs/api',
      logStreamNamePrefix: 'app/',
    });
  });

  it('stops searching older time once it has enough lines', async () => {
    withLogGroup();
    const events = Array.from({ length: 500 }, (_, index) => ({ eventId: String(index), timestamp: 1, message: 'x' }));
    logs.on(FilterLogEventsCommand).resolves({ events });
    await AWS_LOG_SOURCE.read(context, { since, until });
    expect(logs.commandCalls(FilterLogEventsCommand)).toHaveLength(1);
  });

  it('quotes a search so it matches as plain text', async () => {
    withLogGroup();
    logs.on(FilterLogEventsCommand).resolves({ events: [] });
    await AWS_LOG_SOURCE.read(context, { since, until, search: 'failed "login"' });
    expect(logs.commandCalls(FilterLogEventsCommand)[0]?.args[0].input.filterPattern).toBe('"failed \\"login\\""');
  });

  it('says when a service does not use CloudWatch', async () => {
    ecs.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: { containerDefinitions: [{ logConfiguration: { logDriver: 'awsfirelens' } }] },
    });
    expect(await AWS_LOG_SOURCE.read(context, { since, until })).toEqual({ available: false, lines: [] });
  });

  it('says when the log group is gone', async () => {
    withLogGroup();
    logs.on(FilterLogEventsCommand).rejects(Object.assign(new Error('x'), { name: 'ResourceNotFoundException' }));
    expect((await AWS_LOG_SOURCE.read(context, { since, until })).available).toBe(false);
  });
});
