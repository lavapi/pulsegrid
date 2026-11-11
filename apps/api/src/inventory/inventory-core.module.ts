import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AuditModule } from '../audit/audit.module';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ACTION_QUEUE_NAME, ActionQueue } from './actions/action-queue';
import { ActionRunStore } from './actions/action-run.store';
import { ActionTracker } from './actions/action-tracker';
import { ActivityWatcher } from './actions/activity-watcher';
import { CredentialVault } from './connection/credential-vault';
import { ExperimentReportCapture } from './experiments/experiment-report-capture';
import { ExperimentReportStore } from './experiments/experiment-report.store';
import { COST_QUEUE_NAME, CostQueue } from './costs/cost-queue';
import { CostRefreshService } from './costs/cost-refresh.service';
import { TokenCipher } from './connection/token-cipher';
import { awsProvider } from './providers/aws/aws.provider';
import { CLOUD_PROVIDER_LIST } from './providers/provider';
import { ProviderRegistry } from './providers/provider-registry';
import { InventorySyncService } from './sync/inventory-sync.service';
import { ResourceStore } from './sync/resource-store';
import { SyncProgressStore } from './sync/sync-progress.store';
import { createQueueConnection, queuePrefix } from '../redis/redis-connection';
import { SYNC_QUEUE_NAME, SyncQueue } from './sync/sync-queue';

@Module({
  imports: [AuditModule],
  providers: [
    ActionRunStore,
    ActionTracker,
    ActivityWatcher,
    {
      provide: ActionQueue,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new ActionQueue(
          new Queue(ACTION_QUEUE_NAME, { connection: createQueueConnection(config.redis), prefix: queuePrefix(config.redis) }),
        ),
    },
    { provide: CLOUD_PROVIDER_LIST, useValue: [awsProvider] },
    ProviderRegistry,
    {
      provide: TokenCipher,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new TokenCipher(config.tokenEncryptionKey),
    },
    CredentialVault,
    ExperimentReportStore,
    ExperimentReportCapture,
    CostRefreshService,
    {
      provide: CostQueue,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new CostQueue(
          new Queue(COST_QUEUE_NAME, { connection: createQueueConnection(config.redis), prefix: queuePrefix(config.redis) }),
        ),
    },
    ResourceStore,
    SyncProgressStore,
    InventorySyncService,
    {
      provide: SyncQueue,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new SyncQueue(
          new Queue(SYNC_QUEUE_NAME, { connection: createQueueConnection(config.redis), prefix: queuePrefix(config.redis) }),
        ),
    },
  ],
  exports: [
    ActionQueue,
    ActionRunStore,
    ActionTracker,
    ActivityWatcher,
    CostQueue,
    CostRefreshService,
    CredentialVault,
    ExperimentReportCapture,
    ExperimentReportStore,
    ProviderRegistry,
    InventorySyncService,
    SyncProgressStore,
    SyncQueue,
  ],
})
export class InventoryCoreModule implements OnApplicationShutdown {
  constructor(
    @Inject(SyncQueue) private readonly queue: SyncQueue,
    @Inject(ActionQueue) private readonly actionQueue: ActionQueue,
    @Inject(CostQueue) private readonly costQueue: CostQueue,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.queue.close(), this.actionQueue.close(), this.costQueue.close()]);
  }
}
