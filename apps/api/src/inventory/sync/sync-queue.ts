import { Queue } from 'bullmq';
import type { AccountRef } from './inventory-sync.service';

export const SYNC_QUEUE_NAME = 'inventory-sync';
export const SYNC_ACCOUNT_JOB = 'sync-account';
export const SYNC_ALL_JOB = 'sync-all';

export class SyncQueue {
  constructor(private readonly queue: Queue) {}

  async enqueue(account: AccountRef): Promise<void> {
    await this.queue.add(SYNC_ACCOUNT_JOB, account, {
      jobId: account.accountId,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async scheduleFullSync(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      SYNC_ALL_JOB,
      { every: everyMs },
      { name: SYNC_ALL_JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
