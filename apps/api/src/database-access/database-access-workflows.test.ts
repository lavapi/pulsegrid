import { DescribeExecutionCommand, SFNClient } from '@aws-sdk/client-sfn';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { MESSAGES } from './database-access-errors';
import { DatabaseAccessWorkflows, expiryOf } from './database-access-workflows';
import { loadDatabaseAccessSetup } from './database-access.settings';

const setup = loadDatabaseAccessSetup({
  DB_ACCESS_GRANT_STATE_MACHINE_ARN: 'arn:aws:states:eu-central-1:200000000000:stateMachine:grant',
  DB_ACCESS_REVOKE_STATE_MACHINE_ARN: 'arn:aws:states:eu-central-1:200000000000:stateMachine:revoke',
  DB_ACCESS_SCHEDULE_GROUP: 'db-access',
});
const settings = setup.ready ? setup.settings : (null as never);
const key = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'x'.repeat(40) };
const sfn = mockClient(SFNClient);

describe('DatabaseAccessWorkflows.follow', () => {
  beforeEach(() => sfn.reset());

  it('checks until the run ends, then returns its output', async () => {
    sfn
      .on(DescribeExecutionCommand)
      .resolvesOnce({ status: 'RUNNING' })
      .resolves({
        status: 'SUCCEEDED',
        output: '{"userName":"pat","userId":"u1","expiresAt":"2026-11-13T12:00:00.000Z"}',
      });
    const workflows = new DatabaseAccessWorkflows(settings, key, { intervalMs: 0, timeoutMs: 1000 });
    expect(await workflows.follow('arn:exec')).toEqual({
      ok: true,
      output: { userName: 'pat', userId: 'u1', expiresAt: '2026-11-13T12:00:00.000Z' },
    });
    expect(sfn.commandCalls(DescribeExecutionCommand)).toHaveLength(2);
  });

  it('gives up readably when a run runs too long, or ends without output', async () => {
    sfn.on(DescribeExecutionCommand).resolves({ status: 'RUNNING' });
    const slow = new DatabaseAccessWorkflows(settings, key, { intervalMs: 5, timeoutMs: 20 });
    expect(await slow.follow('arn:exec')).toEqual({ ok: false, failure: MESSAGES.retry });
    sfn.on(DescribeExecutionCommand).resolves({ status: 'SUCCEEDED', output: 'not json' });
    expect(await slow.follow('arn:exec')).toEqual({ ok: false, failure: MESSAGES.retry });
  });
});

describe('expiryOf', () => {
  it('reads the end time from a one-time schedule in UTC only', () => {
    expect(expiryOf('at(2026-11-13T18:30:00)', 'UTC')).toBe('2026-11-13T18:30:00.000Z');
    expect(expiryOf('at(2026-11-13T18:30:00)', undefined)).toBe('2026-11-13T18:30:00.000Z');
    expect(expiryOf('at(2026-11-13T18:30:00)', 'Europe/Berlin')).toBeNull();
    expect(expiryOf('rate(5 minutes)', 'UTC')).toBeNull();
  });
});
