import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { createQueueConnection, queuePrefix } from '../redis/redis-connection';
import { SecurityAlertsNotifier } from './security-alerts.notifier';
import { NOTIFY_JOB, type NotifyJob, SECURITY_ALERTS_QUEUE_NAME } from './security-alerts.queue';

/** Sends the notifications for new critical and high alerts. */
@Injectable()
export class SecurityAlertsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SecurityAlertsWorker.name);
  private worker?: Worker;

  constructor(
    private readonly notifier: SecurityAlertsNotifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker(SECURITY_ALERTS_QUEUE_NAME, (job) => this.run(job), {
      connection: createQueueConnection(this.config.redis),
      prefix: queuePrefix(this.config.redis),
      concurrency: 2,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Security alert ${job?.name ?? 'job'} failed: ${error.name}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private run(job: Job): Promise<void> {
    return job.name === NOTIFY_JOB ? this.notifier.notify(job.data as NotifyJob) : Promise.resolve();
  }
}
