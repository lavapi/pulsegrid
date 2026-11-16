import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseAccessCoreModule } from './database-access/database-access-core.module';
import { DatabaseAccessWorker } from './database-access/database-access.worker';
import { DatabaseModule } from './database/database.module';
import { ActionWorker } from './inventory/actions/action-worker';
import { CostWorker } from './inventory/costs/cost-worker';
import { ExperimentWaveWorker } from './inventory/experiments/experiment-wave-worker';
import { InventoryCoreModule } from './inventory/inventory-core.module';
import { SyncWorker } from './inventory/sync/sync-worker';
import { RedisModule } from './redis/redis.module';
import { SecurityAlertsCoreModule } from './security-alerts/security-alerts-core.module';
import { SecurityAlertsNotifier } from './security-alerts/security-alerts.notifier';
import { SecurityAlertsWorker } from './security-alerts/security-alerts.worker';
import { SecurityHubCheck } from './security-alerts/security-hub-check';

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, InventoryCoreModule, DatabaseAccessCoreModule, SecurityAlertsCoreModule],
  providers: [
    ActionWorker,
    CostWorker,
    DatabaseAccessWorker,
    ExperimentWaveWorker,
    SecurityAlertsNotifier,
    SecurityAlertsWorker,
    SecurityHubCheck,
    SyncWorker,
  ],
})
export class WorkerModule {}
