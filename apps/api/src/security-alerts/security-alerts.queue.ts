import type { Queue } from 'bullmq';

export const SECURITY_ALERTS_QUEUE_NAME = 'security-alerts';
export const NOTIFY_JOB = 'notify';
export const CHECK_JOB = 'check-security-hub';

export interface NotifyJob {
  tenantId: string;
  alertId: string;
}

/** Notifications for new alerts, sent once per alert even if the webhook is retried. */
export class SecurityAlertsQueue {
  constructor(private readonly queue: Queue) {}

  async notify(job: NotifyJob): Promise<void> {
    await this.queue.add(NOTIFY_JOB, job, {
      jobId: `notify-${job.alertId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 15_000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
  }

  /** Runs the Security Hub check on a schedule, or stops it when the check is turned off. */
  async scheduleCheck(everyMinutes: number | null): Promise<void> {
    if (everyMinutes === null) {
      await this.queue.removeJobScheduler(CHECK_JOB);
      return;
    }
    await this.queue.upsertJobScheduler(
      CHECK_JOB,
      { every: everyMinutes * 60_000 },
      { name: CHECK_JOB, opts: { removeOnComplete: true, removeOnFail: 20 } },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
