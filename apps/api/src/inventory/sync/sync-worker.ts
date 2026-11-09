import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { createQueueConnection, queuePrefix } from '../../redis/redis-connection';
import { type AccountRef, InventorySyncService } from './inventory-sync.service';
import { SyncProgressStore } from './sync-progress.store';
import {
  SYNC_ACCOUNT_JOB,
  SYNC_ALL_JOB,
  SYNC_QUEUE_NAME,
  SyncQueue,
} from './sync-queue';
import type { SyncReporter } from './sync-tracker';

const FULL_SYNC_INTERVAL_MS = 2 * 60 * 1000;
const ACCOUNTS_AT_ONCE = 3;
const SYNC_FAILED = "The sync couldn't finish. Please try again.";

@Injectable()
export class SyncWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SyncWorker.name);
  private worker?: Worker;

  constructor(
    private readonly sync: InventorySyncService,
    private readonly queue: SyncQueue,
    private readonly progress: SyncProgressStore,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.scheduleFullSync(FULL_SYNC_INTERVAL_MS);
    this.worker = new Worker(SYNC_QUEUE_NAME, (job) => this.process(job), {
      connection: createQueueConnection(this.config.redis),
      prefix: queuePrefix(this.config.redis),
      concurrency: ACCOUNTS_AT_ONCE,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Sync job ${job?.name ?? 'unknown'} failed: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  async process(job: Pick<Job, 'name' | 'data'>): Promise<void> {
    if (job.name === SYNC_ALL_JOB) {
      const accounts = await this.sync.connectedAccounts();
      await Promise.all(accounts.map((account) => this.queue.enqueue(account)));
      return;
    }
    if (job.name === SYNC_ACCOUNT_JOB) {
      const account = job.data as AccountRef;
      await this.tracked(account, (reporter) => this.sync.syncAccount(account, reporter));
    }
  }

  private async tracked(
    target: AccountRef,
    work: (reporter: SyncReporter) => Promise<void>,
  ): Promise<void> {
    const tracker = this.progress.begin(target);
    try {
      await work(tracker);
      await tracker.finish();
    } catch (error) {
      await tracker.fail(SYNC_FAILED);
      throw error;
    }
  }
}
