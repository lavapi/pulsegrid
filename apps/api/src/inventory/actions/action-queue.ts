import type { Queue } from 'bullmq';

export const ACTION_QUEUE_NAME = 'cloud-actions';
export const CHECK_ACTION_JOB = 'check-action';
export const WATCH_ACTIVITY_JOB = 'watch-activity';

const CHECK_EVERY_MS = 10_000;

export interface ActionRunRef {
  tenantId: string;
  runId: string;
}

export class ActionQueue {
  constructor(private readonly queue: Queue) {}

  async scheduleCheck(run: ActionRunRef): Promise<void> {
    await this.queue.add(CHECK_ACTION_JOB, run, {
      delay: CHECK_EVERY_MS,
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async scheduleWatch(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(
      WATCH_ACTIVITY_JOB,
      { every: everyMs },
      { name: WATCH_ACTIVITY_JOB, opts: { removeOnComplete: true, removeOnFail: true } },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
