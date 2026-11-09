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
import { InventorySyncService } from '../sync/inventory-sync.service';
import {
  ACTION_QUEUE_NAME,
  ActionQueue,
  type ActionRunRef,
  CHECK_ACTION_JOB,
  WATCH_ACTIVITY_JOB,
} from './action-queue';
import { ActionTracker } from './action-tracker';
import { ActivityWatcher } from './activity-watcher';

const CHECKS_AT_ONCE = 5;
const WATCH_EVERY_MS = 30_000;

@Injectable()
export class ActionWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ActionWorker.name);
  private worker?: Worker;

  constructor(
    private readonly tracker: ActionTracker,
    private readonly watcher: ActivityWatcher,
    private readonly queue: ActionQueue,
    private readonly sync: InventorySyncService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.scheduleWatch(WATCH_EVERY_MS);
    this.worker = new Worker(ACTION_QUEUE_NAME, (job) => this.process(job), {
      connection: createQueueConnection(this.config.redis),
      prefix: queuePrefix(this.config.redis),
      concurrency: CHECKS_AT_ONCE,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Action check ${job?.id ?? 'unknown'} failed: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Pick<Job, 'name' | 'data'>): Promise<void> {
    if (job.name === CHECK_ACTION_JOB) {
      await this.tracker.check(job.data as ActionRunRef);
    }
    if (job.name === WATCH_ACTIVITY_JOB) {
      const accounts = await this.sync.connectedAccounts();
      await Promise.all(accounts.map((account) => this.watcher.watch(account)));
    }
  }
}
