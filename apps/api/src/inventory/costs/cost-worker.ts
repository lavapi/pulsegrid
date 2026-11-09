import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { createQueueConnection, queuePrefix } from '../../redis/redis-connection';
import { COST_QUEUE_NAME, CostQueue } from './cost-queue';
import { CostRefreshService } from './cost-refresh.service';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class CostWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(CostWorker.name);
  private worker?: Worker;

  constructor(
    private readonly refresh: CostRefreshService,
    private readonly queue: CostQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.scheduleRefresh(CHECK_INTERVAL_MS);
    this.worker = new Worker(COST_QUEUE_NAME, () => this.refresh.refreshDueAccounts(), {
      connection: createQueueConnection(this.config.redis),
      prefix: queuePrefix(this.config.redis),
    });
    this.worker.on('failed', (_job, error) => {
      this.logger.error(`Cost refresh failed: ${error.message}`);
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }
}
