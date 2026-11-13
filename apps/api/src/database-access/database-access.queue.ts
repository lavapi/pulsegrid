import type { Queue } from 'bullmq';

export const DATABASE_ACCESS_QUEUE_NAME = 'database-access';
export const FOLLOW_JOB = 'follow';
export const EXPIRE_JOB = 'expire';
export const RECONCILE_JOB = 'reconcile';

export type WorkflowKind = 'grant' | 'extend' | 'revoke';

export interface GrantJob {
  tenantId: string;
  grantId: string;
}

export interface FollowJob extends GrantJob {
  kind: WorkflowKind;
}

const KEEP = { removeOnComplete: true, removeOnFail: 100 } as const;
const expiryJobId = (grantId: string) => `expire-${grantId}`;

/** Following a workflow run, the delayed job at each grant's end, and the reconcile every 5 minutes. */
export class DatabaseAccessQueue {
  constructor(private readonly queue: Queue) {}

  async follow(job: FollowJob): Promise<void> {
    await this.queue.add(FOLLOW_JOB, job, { jobId: `${job.kind}-${job.grantId}-${Date.now()}`, attempts: 1, ...KEEP });
  }

  /** The job at the grant's end, replacing any earlier one for the grant. */
  async expireAt(job: GrantJob, at: Date): Promise<void> {
    await this.cancelExpiry(job.grantId);
    await this.queue.add(EXPIRE_JOB, job, {
      jobId: expiryJobId(job.grantId),
      delay: Math.max(0, at.getTime() - Date.now()),
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
      ...KEEP,
    });
  }

  async cancelExpiry(grantId: string): Promise<void> {
    await this.queue.remove(expiryJobId(grantId));
  }

  async scheduleReconcile(everyMs: number): Promise<void> {
    await this.queue.upsertJobScheduler(RECONCILE_JOB, { every: everyMs }, { name: RECONCILE_JOB, opts: KEEP });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
