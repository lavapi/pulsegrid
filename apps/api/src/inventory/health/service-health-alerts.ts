import { Inject, Injectable } from '@nestjs/common';
import { resourceTypeLabel, type ResourceType } from '@pulsegrid/shared';
import type Redis from 'ioredis';
import type { Kysely } from 'kysely';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/schema';
import { TenantDatabase } from '../../database/tenant-database';
import { PushNotifier } from '../../push/push-notifier';
import { REDIS } from '../../redis/redis.module';

/** A service that recovers and turns degraded again within this long is not announced again. */
const QUIET_AFTER_RECOVERY_SECONDS = 30 * 60;

const degradedKey = (tenantId: string) => `service-health:degraded:${tenantId}`;
const quietKey = (resourceId: string) => `service-health:quiet:${resourceId}`;

interface DegradedResource {
  id: string;
  name: string;
  displayName: string | null;
  type: ResourceType;
  region: string;
  environmentName: string | null;
  production: boolean;
}

/**
 * Tells people on their phones when a service turns degraded, once until it is healthy again. Production and
 * staging are separate choices in each person's notification settings.
 */
@Injectable()
export class ServiceHealthAlerts {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly push: PushNotifier,
  ) {}

  async check(): Promise<void> {
    const tenants = await this.db.selectFrom('tenants').select('id').execute();
    for (const { id } of tenants) await this.checkProject(id);
  }

  private async checkProject(tenantId: string): Promise<void> {
    const degraded = await this.degradedIn(tenantId);
    const now = new Set(degraded.map(({ id }) => id));
    const known = new Set(await this.redis.smembers(degradedKey(tenantId)));

    for (const id of known) {
      if (now.has(id)) continue;
      await this.redis.set(quietKey(id), '1', 'EX', QUIET_AFTER_RECOVERY_SECONDS);
      await this.redis.srem(degradedKey(tenantId), id);
    }
    for (const resource of degraded) {
      if (known.has(resource.id)) continue;
      await this.redis.sadd(degradedKey(tenantId), resource.id);
      if (await this.redis.exists(quietKey(resource.id))) continue;
      this.announce(tenantId, resource);
    }
  }

  private announce(tenantId: string, resource: DegradedResource): void {
    const where = [resourceTypeLabel(resource.type), resource.environmentName, resource.region].filter(Boolean).join(' · ');
    this.push.toProject(tenantId, resource.production ? 'unhealthy_production' : 'unhealthy_staging', {
      title: `${resource.displayName ?? resource.name} is degraded`,
      body: where,
      path: `/infrastructure/${resource.id}`,
      collapseId: `health-${resource.id}`,
    });
  }

  private degradedIn(tenantId: string): Promise<DegradedResource[]> {
    return this.database.run(tenantId, (trx) =>
      trx
        .selectFrom('resources')
        .innerJoin('cloud_accounts', 'cloud_accounts.id', 'resources.cloud_account_id')
        .leftJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
        .leftJoin('resource_display_names', (join) =>
          join
            .onRef('resource_display_names.cloud_account_id', '=', 'resources.cloud_account_id')
            .onRef('resource_display_names.native_id', '=', 'resources.native_id'),
        )
        .select([
          'resources.id',
          'resources.name',
          'resource_display_names.display_name as displayName',
          'resources.type',
          'resources.region',
          'environments.name as environmentName',
        ])
        .select((eb) => eb.fn.coalesce('environments.is_production', eb.lit(false)).as('production'))
        .where('resources.health', '=', 'degraded')
        .execute(),
    );
  }
}
