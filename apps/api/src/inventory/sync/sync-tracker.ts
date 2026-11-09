import type { SyncAccountProgress, SyncProgress } from '@pulsegrid/shared';

const MAX_RUNNING_PERCENT = 99;

export interface SyncReporter {
  accounts(accounts: readonly { id: string; name: string }[]): Promise<void>;
  accountStarted(accountId: string, totalTasks: number): Promise<void>;
  taskStarted(accountId: string, label: string): Promise<void>;
  taskFinished(accountId: string, label: string, result: TaskResult): Promise<void>;
  accountFinished(accountId: string): Promise<void>;
  fail(message: string): Promise<void>;
}

export type TaskResult = { resources: number } | { issue: string };

const skip = (): Promise<void> => Promise.resolve();

export const NO_SYNC_REPORTER: SyncReporter = {
  accounts: skip,
  accountStarted: skip,
  taskStarted: skip,
  taskFinished: skip,
  accountFinished: skip,
  fail: skip,
};

const fractionOf = ({ state, completedTasks, totalTasks }: SyncAccountProgress): number => {
  if (state === 'done') {
    return 1;
  }
  return totalTasks > 0 ? completedTasks / totalTasks : 0;
};

export const percentOf = (accounts: readonly SyncAccountProgress[]): number => {
  if (accounts.length === 0) {
    return 0;
  }
  const total = accounts.reduce((sum, account) => sum + fractionOf(account), 0);
  return Math.min(Math.round((total / accounts.length) * 100), MAX_RUNNING_PERCENT);
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

export const finishedMessage = (accounts: readonly SyncAccountProgress[]): string => {
  const resources = accounts.reduce((sum, account) => sum + account.resources, 0);
  const issues = accounts.reduce((sum, account) => sum + account.failedTasks, 0);
  const summary = `${plural(resources, 'resource')} in ${plural(accounts.length, 'account')}`;
  return issues > 0
    ? `Sync finished: ${summary}. ${plural(issues, 'area')} couldn't be read.`
    : `Sync finished: ${summary}.`;
};

export class SyncTracker implements SyncReporter {
  constructor(
    private progress: SyncProgress,
    private readonly publish: (progress: SyncProgress) => Promise<void>,
  ) {}

  accounts(accounts: readonly { id: string; name: string }[]): Promise<void> {
    return this.update({
      phase: 'reading',
      accounts: accounts.map(({ id, name }) => ({
        id,
        name,
        state: 'waiting',
        reading: [],
        resources: 0,
        issues: [],
        failedTasks: 0,
        completedTasks: 0,
        totalTasks: 0,
      })),
    });
  }

  accountStarted(accountId: string, totalTasks: number): Promise<void> {
    return this.updateAccount(accountId, (account) => ({
      ...account,
      state: 'running',
      totalTasks,
    }));
  }

  taskStarted(accountId: string, label: string): Promise<void> {
    return this.updateAccount(accountId, (account) => ({
      ...account,
      reading: [...new Set([...account.reading, label])],
    }));
  }

  taskFinished(accountId: string, label: string, result: TaskResult): Promise<void> {
    return this.updateAccount(accountId, (account) => ({
      ...account,
      reading: account.reading.filter((item) => item !== label),
      completedTasks: account.completedTasks + 1,
      ...('issue' in result
        ? {
            issues: [...new Set([...account.issues, result.issue])],
            failedTasks: account.failedTasks + 1,
          }
        : { resources: account.resources + result.resources }),
    }));
  }

  accountFinished(accountId: string): Promise<void> {
    return this.updateAccount(accountId, (account) => ({ ...account, state: 'done', reading: [] }));
  }

  fail(message: string): Promise<void> {
    return this.update({ phase: 'failed', message });
  }

  finish(): Promise<void> {
    if (this.progress.phase === 'failed') {
      return Promise.resolve();
    }
    return this.update({
      phase: 'finished',
      percent: 100,
      message: finishedMessage(this.progress.accounts),
    });
  }

  private updateAccount(
    accountId: string,
    change: (account: SyncAccountProgress) => SyncAccountProgress,
  ): Promise<void> {
    const accounts = this.progress.accounts.map((account) =>
      account.id === accountId ? change(account) : account,
    );
    return this.update({ accounts, percent: percentOf(accounts) });
  }

  private update(change: Partial<SyncProgress>): Promise<void> {
    this.progress = { ...this.progress, ...change };
    return this.publish(this.progress);
  }
}
