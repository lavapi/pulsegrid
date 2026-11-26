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
import { NotificationsCoreModule } from './notifications/notifications-core.module';
import { NotificationsCheck } from './notifications/notifications-check';
import { NotificationsWorker } from './notifications/notifications.worker';
import { RedisModule } from './redis/redis.module';
import { ReleasesModule } from './releases/releases.module';

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, InventoryCoreModule, DatabaseAccessCoreModule, NotificationsCoreModule, ReleasesModule],
  providers: [
    ActionWorker,
    CostWorker,
    DatabaseAccessWorker,
    ExperimentWaveWorker,
    NotificationsCheck,
    NotificationsWorker,
    SyncWorker,
  ],
})
export class WorkerModule {}
