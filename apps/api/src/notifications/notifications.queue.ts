import type { Queue } from 'bullmq';

export const NOTIFICATIONS_QUEUE_NAME = 'notifications';
export const CHECK_JOB = 'check';

/** The check behind personal Slack messages, run on a schedule. */
export class NotificationsQueue {
  constructor(private readonly queue: Queue) {}

  async scheduleCheck(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      CHECK_JOB,
      { every: everyMs },
      { name: CHECK_JOB, opts: { removeOnComplete: true, removeOnFail: 20 } },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
