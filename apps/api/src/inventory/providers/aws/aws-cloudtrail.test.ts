import { CloudTrailClient, LookupEventsCommand } from '@aws-sdk/client-cloudtrail';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { actionLabel, actorOf, AWS_ACTIVITY_SOURCE } from './aws-cloudtrail';

const trail = mockClient(CloudTrailClient);
const context = {
  credentials: { accessKeyId: 'AKIADASHBOARD', secretAccessKey: 'b' },
  regions: ['eu-central-1'],
};
const event = (id: string, minutes: number, name: string, identity: object = {}) => ({
  EventId: id,
  EventName: name,
  EventTime: new Date(Date.UTC(2026, 10, 6, 12, minutes)),
  Username: 'fallback',
  Resources: [{ ResourceName: 'i-123' }],
  CloudTrailEvent: JSON.stringify({ userIdentity: identity, sourceIPAddress: '10.0.0.1', errorCode: 'Denied' }),
});

beforeEach(() => trail.reset());

describe('names', () => {
  it('reads actions', () => {
    expect(actionLabel('RebootInstances')).toBe('Reboot server');
    expect(actionLabel('DescribeSomething')).toBe('Describe Something');
  });

  it.each([
    [{ type: 'IAMUser', userName: 'alex' }, 'alex'],
    [{ type: 'Root' }, 'Root user'],
    [{ type: 'AssumedRole', principalId: 'AROA:alex@example.test' }, 'alex@example.test'],
    [{ type: 'AssumedRole', principalId: 'AROA:deploy', sessionContext: { sessionIssuer: { userName: 'ci' } } }, 'ci (deploy)'],
    [{ type: 'AWSService', invokedBy: 'ecs.amazonaws.com' }, 'ecs.amazonaws.com'],
  ])('names %o', (identity, name) => {
    expect(actorOf(identity, undefined)).toBe(name);
  });

  it('falls back to the event username', () => {
    expect(actorOf(undefined, 'fallback')).toBe('fallback');
    expect(actorOf(undefined, undefined)).toBe('Unknown');
  });
});

describe('AWS_ACTIVITY_SOURCE', () => {
  it('reads changes only by default, from the account regions and the global region', async () => {
    trail.on(LookupEventsCommand).resolves({ Events: [] });
    await AWS_ACTIVITY_SOURCE.read(context, {});
    const calls = trail.commandCalls(LookupEventsCommand);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args[0].input.LookupAttributes).toEqual([{ AttributeKey: 'ReadOnly', AttributeValue: 'false' }]);
  });

  it('merges regions newest first without repeats, and marks the dashboard key', async () => {
    trail
      .on(LookupEventsCommand)
      .resolvesOnce({ Events: [event('1', 1, 'StopInstances', { accessKeyId: 'AKIADASHBOARD' })] })
      .resolvesOnce({ Events: [event('1', 1, 'StopInstances', { accessKeyId: 'AKIADASHBOARD' }), event('2', 5, 'RebootInstances', { type: 'IAMUser', userName: 'alex' })] });
    const { events, before } = await AWS_ACTIVITY_SOURCE.read(context, {});
    expect(events.map(({ id }) => id)).toEqual(['2', '1']);
    expect(events[0]).toMatchObject({
      actor: 'alex',
      label: 'Reboot server',
      resource: 'i-123',
      sourceIp: '10.0.0.1',
      errorCode: 'Denied',
      viaDashboard: false,
    });
    expect(events[1]?.viaDashboard).toBe(true);
    expect(before).toBeNull();
  });

  it('looks up one filter and applies the others here', async () => {
    trail.on(LookupEventsCommand).resolves({
      Events: [event('1', 1, 'StopInstances', { userName: 'alex' }), event('2', 2, 'StartInstances', { userName: 'sam' })],
    });
    const { events } = await AWS_ACTIVITY_SOURCE.read(context, { resource: 'i-123', actor: 'ALE' });
    expect(events.map(({ actor }) => actor)).toEqual(['alex']);
    expect(trail.commandCalls(LookupEventsCommand)[0]?.args[0].input.LookupAttributes).toEqual([
      { AttributeKey: 'ResourceName', AttributeValue: 'i-123' },
    ]);
  });

  it('offers older events after a full page', async () => {
    const full = Array.from({ length: 50 }, (_, index) => event(String(index), index, 'StopInstances'));
    trail.on(LookupEventsCommand).resolves({ Events: full });
    const { before } = await AWS_ACTIVITY_SOURCE.read(context, {});
    expect(before).toBe('2026-11-06T12:00:00.000Z');
  });

  it('survives a record it cannot read', async () => {
    trail.on(LookupEventsCommand).resolves({ Events: [{ EventId: '1', EventName: 'X', CloudTrailEvent: 'not json', Username: 'alex' }] });
    const { events } = await AWS_ACTIVITY_SOURCE.read(context, {});
    expect(events[0]?.actor).toBe('alex');
  });
});
