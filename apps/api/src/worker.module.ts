import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { ActionWorker } from './inventory/actions/action-worker';
import { CostWorker } from './inventory/costs/cost-worker';
import { ExperimentWaveWorker } from './inventory/experiments/experiment-wave-worker';
import { InventoryCoreModule } from './inventory/inventory-core.module';
import { SyncWorker } from './inventory/sync/sync-worker';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [ConfigModule, DatabaseModule, RedisModule, InventoryCoreModule],
  providers: [ActionWorker, CostWorker, ExperimentWaveWorker, SyncWorker],
})
export class WorkerModule {}
