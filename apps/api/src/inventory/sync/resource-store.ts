import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../database/tenant-context';
import { chunk } from '../../common/chunk';
import type { CollectedResource, ResourceCollector } from '../providers/provider';

const ROWS_PER_INSERT = 500;

export interface ResourceScope {
  tenantId: string;
  cloudAccountId: string;
  seenAt: Date;
}

@Injectable()
export class ResourceStore {
  async save(
    trx: TenantTransaction,
    scope: ResourceScope,
    collector: ResourceCollector,
    resources: readonly CollectedResource[],
  ): Promise<void> {
    for (const batch of chunk(resources, ROWS_PER_INSERT)) {
      await trx
        .insertInto('resources')
        .values(
          batch.map((resource) => ({
            tenant_id: scope.tenantId,
            cloud_account_id: scope.cloudAccountId,
            region: resource.region,
            type: resource.type,
            service: collector.name,
            native_id: resource.nativeId,
            name: resource.name,
            status: resource.status,
            health: resource.health,
            tags: JSON.stringify(resource.tags),
            details: JSON.stringify(resource.details),
            last_seen_at: scope.seenAt,
          })),
        )
        .onConflict((conflict) =>
          conflict.columns(['cloud_account_id', 'type', 'region', 'native_id']).doUpdateSet({
            name: sql.ref('excluded.name'),
            status: sql.ref('excluded.status'),
            health: sql.ref('excluded.health'),
            tags: sql.ref('excluded.tags'),
            details: sql.ref('excluded.details'),
            last_seen_at: sql.ref('excluded.last_seen_at'),
          }),
        )
        .execute();
    }
  }

  async removeMissing(
    trx: TenantTransaction,
    scope: ResourceScope,
    collector: ResourceCollector,
    region: string,
  ): Promise<void> {
    let query = trx
      .deleteFrom('resources')
      .where('cloud_account_id', '=', scope.cloudAccountId)
      .where('type', 'in', [...collector.types])
      .where('last_seen_at', '<', scope.seenAt);
    if (collector.scope === 'regional') {
      query = query.where('region', '=', region);
    }
    await query.execute();
  }
}
