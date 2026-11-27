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
import { ProductionReleaseAlerts } from './production-releases/production-release-alerts';
import { ProductionReleaseAlertsWorker } from './production-releases/production-release-alerts.worker';
import { ProductionReleasesCoreModule } from './production-releases/production-releases-core.module';
import { PushCoreModule } from './push/push-core.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RedisModule,
    InventoryCoreModule,
    DatabaseAccessCoreModule,
    ProductionReleasesCoreModule,
    PushCoreModule,
  ],
  providers: [
    ActionWorker,
    CostWorker,
    DatabaseAccessWorker,
    ExperimentWaveWorker,
    ProductionReleaseAlerts,
    ProductionReleaseAlertsWorker,
    SyncWorker,
  ],
})
export class WorkerModule {}
