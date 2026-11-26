import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { createQueueConnection, queuePrefix } from '../redis/redis-connection';
import { ProductionReleaseAlerts } from './production-release-alerts';

const QUEUE_NAME = 'production-release-alerts';
const CHECK_JOB = 'check';
const CHECK_EVERY_MS = 60_000;
const KEEP = { removeOnComplete: 10, removeOnFail: 10 };

/** Checks once a minute whether a production release is waiting, when production releases are set up. */
@Injectable()
export class ProductionReleaseAlertsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ProductionReleaseAlertsWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly alerts: ProductionReleaseAlerts,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.alerts.enabled) return;
    const connection = { connection: createQueueConnection(this.config.redis), prefix: queuePrefix(this.config.redis) };
    this.queue = new Queue(QUEUE_NAME, connection);
    await this.queue.upsertJobScheduler(CHECK_JOB, { every: CHECK_EVERY_MS }, { name: CHECK_JOB, opts: KEEP });
    this.worker = new Worker(QUEUE_NAME, () => this.alerts.check(), {
      connection: createQueueConnection(this.config.redis),
      prefix: queuePrefix(this.config.redis),
      concurrency: 1,
    });
    this.worker.on('failed', (_job, error) => this.logger.warn(`Checking for a waiting release failed: ${error.name}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
