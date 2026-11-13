import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { createQueueConnection, queuePrefix } from '../redis/redis-connection';
import { DatabaseAccessJobs } from './database-access.jobs';
import {
  DATABASE_ACCESS_QUEUE_NAME,
  DatabaseAccessQueue,
  EXPIRE_JOB,
  FOLLOW_JOB,
  type FollowJob,
  type GrantJob,
  RECONCILE_JOB,
} from './database-access.queue';
import { DATABASE_ACCESS_SETUP, type DatabaseAccessSetup } from './database-access.settings';

const RECONCILE_EVERY_MS = 5 * 60_000;
const CONCURRENCY = 4;

/** Follows workflow runs, ends access at its end time, and reconciles every 5 minutes, when the feature is set up. */
@Injectable()
export class DatabaseAccessWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseAccessWorker.name);
  private worker?: Worker;

  constructor(
    private readonly jobs: DatabaseAccessJobs,
    private readonly queue: DatabaseAccessQueue,
    @Inject(DATABASE_ACCESS_SETUP) private readonly setup: DatabaseAccessSetup,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.setup.ready) {
      return;
    }
    await this.queue.scheduleReconcile(RECONCILE_EVERY_MS);
    this.worker = new Worker(DATABASE_ACCESS_QUEUE_NAME, (job) => this.run(job), {
      connection: createQueueConnection(this.config.redis),
      prefix: queuePrefix(this.config.redis),
      concurrency: CONCURRENCY,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Database access ${job?.name ?? 'job'} failed: ${error.name}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private run(job: Job): Promise<void> {
    switch (job.name) {
      case FOLLOW_JOB:
        return this.jobs.follow(job.data as FollowJob);
      case EXPIRE_JOB:
        return this.jobs.expire(job.data as GrantJob);
      case RECONCILE_JOB:
        return this.jobs.reconcile();
      default:
        return Promise.resolve();
    }
  }
}
