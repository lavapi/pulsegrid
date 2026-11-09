import type { SyncProgress } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { finishedMessage, percentOf, SyncTracker } from './sync-tracker';

const start: SyncProgress = {
  key: 'k',
  accountId: 'a',
  phase: 'queued',
  percent: 0,
  accounts: [],
  message: null,
  startedAt: 'now',
};

const tracker = () => {
  const published: SyncProgress[] = [];
  const instance = new SyncTracker(start, async (progress) => {
    published.push(progress);
  });
  return { instance, latest: () => published.at(-1) as SyncProgress };
};

describe('SyncTracker', () => {
  it('tracks each account while reading', async () => {
    const { instance, latest } = tracker();
    await instance.accounts([{ id: 'a', name: 'Staging' }, { id: 'b', name: 'Production' }]);
    await instance.accountStarted('a', 2);
    await instance.taskStarted('a', 'ECS');
    expect(latest().accounts[0]).toMatchObject({ state: 'running', reading: ['ECS'] });
    expect(latest().accounts[1]?.state).toBe('waiting');
    await instance.taskFinished('a', 'ECS', { resources: 5 });
    expect(latest().percent).toBe(25);
    await instance.taskFinished('a', 'RDS', { issue: 'No access to RDS' });
    await instance.accountFinished('a');
    expect(latest().percent).toBe(50);
    expect(latest().accounts[0]).toMatchObject({
      state: 'done',
      resources: 5,
      issues: ['No access to RDS'],
      reading: [],
    });
  });

  it('keeps a label while another region still reads it', async () => {
    const { instance, latest } = tracker();
    await instance.accounts([{ id: 'a', name: 'Staging' }]);
    await instance.taskStarted('a', 'ECS');
    await instance.taskStarted('a', 'ECS');
    expect(latest().accounts[0]?.reading).toEqual(['ECS']);
  });

  it('shows a repeated problem once, but still counts it', async () => {
    const { instance, latest } = tracker();
    await instance.accounts([{ id: 'a', name: 'Staging' }]);
    await instance.taskFinished('a', 'ECS', { issue: 'No access' });
    await instance.taskFinished('a', 'ECS', { issue: 'No access' });
    expect(latest().accounts[0]).toMatchObject({ issues: ['No access'], failedTasks: 2 });
  });

  it('reaches 100 only when finished', async () => {
    const { instance, latest } = tracker();
    await instance.accounts([{ id: 'a', name: 'Staging' }]);
    await instance.accountStarted('a', 1);
    await instance.accountFinished('a');
    expect(latest().percent).toBe(99);
    await instance.finish();
    expect(latest()).toMatchObject({ phase: 'finished', percent: 100 });
  });

  it('keeps a failure once it has happened', async () => {
    const { instance, latest } = tracker();
    await instance.fail('Your AWS session has expired.');
    await instance.finish();
    expect(latest()).toMatchObject({ phase: 'failed', message: 'Your AWS session has expired.' });
  });
});

describe('percentOf', () => {
  it('is zero with no accounts', () => {
    expect(percentOf([])).toBe(0);
  });
});

describe('finishedMessage', () => {
  const account = { resources: 2, failedTasks: 0 } as never;

  it('summarizes resources and accounts', () => {
    expect(finishedMessage([account])).toBe('Sync finished: 2 resources in 1 account.');
  });

  it('mentions areas that could not be read', () => {
    const failing = { resources: 1, failedTasks: 1 } as never;
    expect(finishedMessage([failing])).toBe(
      "Sync finished: 1 resource in 1 account. 1 area couldn't be read.",
    );
  });
});
