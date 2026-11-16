import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { createQueueConnection, queuePrefix } from '../redis/redis-connection';
import { SecurityAlertsNotifier } from './security-alerts.notifier';
import {
  CHECK_JOB,
  NOTIFY_JOB,
  type NotifyJob,
  SECURITY_ALERTS_QUEUE_NAME,
  SecurityAlertsQueue,
} from './security-alerts.queue';
import { SECURITY_ALERTS_SETTINGS, type SecurityAlertsSettings } from './security-alerts.settings';
import { SecurityHubCheck } from './security-hub-check';

/** Sends the notifications for new critical and high alerts, and runs the Security Hub check on its schedule. */
@Injectable()
export class SecurityAlertsWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SecurityAlertsWorker.name);
  private worker?: Worker;

  constructor(
    private readonly notifier: SecurityAlertsNotifier,
    private readonly check: SecurityHubCheck,
    private readonly queue: SecurityAlertsQueue,
    @Inject(SECURITY_ALERTS_SETTINGS) private readonly settings: SecurityAlertsSettings,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.scheduleCheck(this.settings.check?.everyMinutes ?? null);
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

  private async run(job: Job): Promise<void> {
    if (job.name === NOTIFY_JOB) {
      await this.notifier.notify(job.data as NotifyJob);
    } else if (job.name === CHECK_JOB) {
      await this.check.run();
    }
  }
}
