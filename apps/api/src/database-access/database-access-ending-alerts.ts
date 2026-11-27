import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { PushNotifier } from '../push/push-notifier';
import { REDIS } from '../redis/redis.module';

/** How long before the end people are told. */
const WARN_BEFORE_MS = 15 * 60_000;
const TOLD_FOR_SECONDS = 24 * 60 * 60;

/**
 * Tells a person on their phone when their production database access is about to end, once for each end time, so
 * an extended grant warns again before its new end.
 */
@Injectable()
export class DatabaseAccessEndingAlerts {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly push: PushNotifier,
  ) {}

  async check(now = new Date()): Promise<void> {
    const tenants = await this.db.selectFrom('tenants').select('id').execute();
    for (const { id: tenantId } of tenants) {
      const ending = await this.database.run(tenantId, (trx) =>
        trx
          .selectFrom('database_access_grants')
          .select(['id', 'user_id', 'expires_at'])
          .where('status', '=', 'active')
          .where('user_id', 'is not', null)
          .where('expires_at', '>', now)
          .where('expires_at', '<=', new Date(now.getTime() + WARN_BEFORE_MS))
          .execute(),
      );
      for (const grant of ending) {
        const key = `database-access:ending:${grant.id}:${grant.expires_at.getTime()}`;
        if ((await this.redis.set(key, '1', 'EX', TOLD_FOR_SECONDS, 'NX')) !== 'OK') continue;
        const minutes = Math.max(1, Math.round((grant.expires_at.getTime() - now.getTime()) / 60_000));
        this.push.toUser(tenantId, grant.user_id as string, 'database_access', {
          title: 'Database access ends soon',
          body: `Your production database access ends in ${minutes} minute${minutes === 1 ? '' : 's'}. Ask for more time in PulseGrid if you need it.`,
          path: '/database-access',
          collapseId: `database-access-ending-${grant.id}`,
        });
      }
    }
  }
}
