import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AuditModule } from '../audit/audit.module';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { InventoryCoreModule } from '../inventory/inventory-core.module';
import { createQueueConnection, queuePrefix } from '../redis/redis-connection';
import { DatabaseAccessOutside } from './database-access-outside';
import { DatabaseAccessTenants, WORKFLOW_POLL } from './database-access-tenants';
import { DEFAULT_POLL } from './database-access-workflows';
import { DatabaseAccessJobs } from './database-access.jobs';
import { DATABASE_ACCESS_QUEUE_NAME, DatabaseAccessQueue } from './database-access.queue';
import { DATABASE_ACCESS_SETUP, loadDatabaseAccessSetup } from './database-access.settings';
import { DatabaseAccessStore } from './database-access.store';

/** What the API and the worker share: the settings, the Production key, the grants and the queue. */
@Module({
  imports: [AuditModule, InventoryCoreModule],
  providers: [
    { provide: DATABASE_ACCESS_SETUP, useFactory: () => loadDatabaseAccessSetup(process.env) },
    { provide: WORKFLOW_POLL, useValue: DEFAULT_POLL },
    {
      provide: DatabaseAccessQueue,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new DatabaseAccessQueue(
          new Queue(DATABASE_ACCESS_QUEUE_NAME, {
            connection: createQueueConnection(config.redis),
            prefix: queuePrefix(config.redis),
          }),
        ),
    },
    DatabaseAccessStore,
    DatabaseAccessTenants,
    DatabaseAccessOutside,
    DatabaseAccessJobs,
  ],
  exports: [
    DATABASE_ACCESS_SETUP,
    DatabaseAccessQueue,
    DatabaseAccessStore,
    DatabaseAccessTenants,
    DatabaseAccessOutside,
    DatabaseAccessJobs,
  ],
})
export class DatabaseAccessCoreModule implements OnApplicationShutdown {
  constructor(@Inject(DatabaseAccessQueue) private readonly queue: DatabaseAccessQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
