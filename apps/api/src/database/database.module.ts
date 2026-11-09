import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { createDatabase } from './connection';
import type { Database } from './schema';
import { TenantDatabase } from './tenant-database';

export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createDatabase(config.databaseUrl),
    },
    {
      provide: TenantDatabase,
      inject: [DATABASE],
      useFactory: (db: Kysely<Database>) => new TenantDatabase(db),
    },
  ],
  exports: [DATABASE, TenantDatabase],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
