import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Worker } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { createQueueConnection, queuePrefix } from '../redis/redis-connection';
import { NotificationsCheck } from './notifications-check';
import { CHECK_JOB, NOTIFICATIONS_QUEUE_NAME, NotificationsQueue } from './notifications.queue';

const CHECK_EVERY_MS = 60_000;

/** Runs the notifications check every minute, one run at a time. */
@Injectable()
export class NotificationsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(NotificationsWorker.name);
  private worker?: Worker;

  constructor(
    private readonly check: NotificationsCheck,
    private readonly queue: NotificationsQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.scheduleCheck(CHECK_EVERY_MS);
    this.worker = new Worker(
      NOTIFICATIONS_QUEUE_NAME,
      async (job) => {
        if (job.name === CHECK_JOB) await this.check.run();
      },
      { connection: createQueueConnection(this.config.redis), prefix: queuePrefix(this.config.redis), concurrency: 1 },
    );
    this.worker.on('failed', (_job, error) => this.logger.error(`Notifications check failed: ${error.name}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
