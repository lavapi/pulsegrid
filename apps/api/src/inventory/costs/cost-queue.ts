import type { Queue } from 'bullmq';

export const COST_QUEUE_NAME = 'cloud-costs';
export const REFRESH_COSTS_JOB = 'refresh-costs';

export class CostQueue {
  constructor(private readonly queue: Queue) {}

  async scheduleRefresh(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      REFRESH_COSTS_JOB,
      { every: everyMs },
      { name: REFRESH_COSTS_JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
