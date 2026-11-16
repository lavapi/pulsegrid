import type { Queue } from 'bullmq';

export const SECURITY_ALERTS_QUEUE_NAME = 'security-alerts';
export const NOTIFY_JOB = 'notify';

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

  async close(): Promise<void> {
    await this.queue.close();
  }
}
