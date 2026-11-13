import {
  categoryOf,
  type HealthCounts,
  type InfrastructureMap,
  type Resource,
  type ResourceHealth,
  type ResourcePage,
  type ResourceType,
  type ResourceTypeCount,
  resourceTypesIn,
  SERVICE_CATEGORIES,
  type ServiceCategory,
  type ServiceCategorySummary,
} from '@pulsegrid/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { ProviderRegistry } from '../providers/provider-registry';
import { encodeResourceCursor, type ResourceCursor } from './resource-cursor';

export interface ResourceFilter {
  type?: ResourceType | undefined;
  category?: ServiceCategory | undefined;
  cloudAccountId?: string | undefined;
  environmentId?: string | undefined;
  region?: string | undefined;
  search?: string | undefined;
  health?: ResourceHealth | undefined;
}

export interface ResourcePageRequest extends ResourceFilter {
  limit: number;
  cursor?: ResourceCursor | undefined;
}

const MAX_MAP_RESOURCES = 5000;
const EMPTY_MAP: InfrastructureMap = { groups: [], nodes: [], edges: [], truncated: false };

export interface Viewer {
  tenantId: string;
}

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (match) => `\\${match}`);

const baseQuery = (trx: TenantTransaction, filter: ResourceFilter) => {
  let query = trx
    .selectFrom('resources')
    .innerJoin('cloud_accounts', 'cloud_accounts.id', 'resources.cloud_account_id')
    .leftJoin('resource_display_names', (join) =>
      join
        .onRef('resource_display_names.cloud_account_id', '=', 'resources.cloud_account_id')
        .onRef('resource_display_names.native_id', '=', 'resources.native_id'),
    );
  if (filter.type) {
    query = query.where('resources.type', '=', filter.type);
  }
  if (filter.category) {
    query = query.where('resources.type', 'in', resourceTypesIn(filter.category));
  }
  if (filter.cloudAccountId) {
    query = query.where('resources.cloud_account_id', '=', filter.cloudAccountId);
  }
  if (filter.environmentId) {
    query = query.where('cloud_accounts.environment_id', '=', filter.environmentId);
  }
  if (filter.region) {
    query = query.where('resources.region', '=', filter.region);
  }
  if (filter.health) {
    query = query.where('resources.health', '=', filter.health);
  }
  if (filter.search) {
    const pattern = `%${escapeLike(filter.search)}%`;
    query = query.where((eb) =>
      eb.or([
        eb('resources.name', 'ilike', pattern),
        eb('resources.native_id', 'ilike', pattern),
        eb('resource_display_names.display_name', 'ilike', pattern),
      ]),
    );
  }
  return query;
};

const selectResource = (query: ReturnType<typeof baseQuery>) =>
  query.select([
    'resources.id',
    'resources.type',
    'resources.native_id',
    'resources.name',
    'resource_display_names.display_name',
    'resources.status',
    'resources.health',
    'resources.region',
    'resources.tags',
    'resources.details',
    'resources.last_seen_at',
    'cloud_accounts.id as cloud_account_uuid',
    'cloud_accounts.account_id',
    'cloud_accounts.name as cloud_account_name',
  ]);

type ResourceRow = Awaited<ReturnType<ReturnType<typeof selectResource>['execute']>>[number];

const toResource = (row: ResourceRow): Resource => ({
  id: row.id,
  type: row.type,
  nativeId: row.native_id,
  name: row.name,
  displayName: row.display_name,
  status: row.status,
  health: row.health,
  region: row.region,
  cloudAccount: { id: row.cloud_account_uuid, accountId: row.account_id, name: row.cloud_account_name },
  tags: row.tags,
  details: row.details,
  lastSeenAt: row.last_seen_at.toISOString(),
});

/** Map nodes show display names; the provider builds the map from cloud names, which it matches by. */
const withDisplayNames = (
  nodes: InfrastructureMap['nodes'],
  resources: readonly Resource[],
): InfrastructureMap['nodes'] => {
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  return nodes.map((node) => {
    const displayName = byId.get(node.id)?.displayName;
    return displayName ? { ...node, name: displayName, awsName: node.name } : node;
  });
};

interface CategoryCount {
  type: ResourceType;
  health: ResourceHealth;
  count: string;
  launch_type: string | null;
}

const emptyHealth = (): HealthCounts => ({ healthy: 0, degraded: 0, stopped: 0, unknown: 0, total: 0 });

export const buildCategorySummaries = (
  counts: readonly CategoryCount[],
): ServiceCategorySummary[] => {
  const summaries = new Map<ServiceCategory, ServiceCategorySummary>();
  for (const { type, health, count, launch_type: launchType } of counts) {
    const category = categoryOf(type);
    const summary =
      summaries.get(category) ??
      ({
        category,
        health: emptyHealth(),
        types: [],
        launchTypes: [],
      } satisfies ServiceCategorySummary);
    const amount = Number(count);
    summary.health[health] += amount;
    summary.health.total += amount;
    const existing = summary.types.find((item) => item.type === type);
    if (existing) {
      existing.count += amount;
    } else {
      summary.types.push({ type, count: amount });
    }
    if (launchType) {
      summary.launchTypes = [...new Set([...summary.launchTypes, ...launchType.split(', ')])].sort();
    }
    summaries.set(category, summary);
  }
  return (Object.keys(SERVICE_CATEGORIES) as ServiceCategory[]).flatMap((category) => {
    const summary = summaries.get(category);
    return summary ? [summary] : [];
  });
};

@Injectable()
export class ResourcesService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly providers: ProviderRegistry,
  ) {}

  list({ tenantId }: Viewer, request: ResourcePageRequest): Promise<ResourcePage> {
    const { limit, cursor } = request;
    return this.database.run(tenantId, async (trx) => {
      let query = selectResource(baseQuery(trx, request))
        .orderBy('resources.name')
        .orderBy('resources.id')
        .limit(limit + 1);
      if (cursor) {
        query = query.where(
          (eb) => sql<boolean>`(${eb.ref('resources.name')}, ${eb.ref('resources.id')}) > (${cursor.name}, ${cursor.id}::uuid)`,
        );
      }
      const rows = await query.execute();
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        resources: page.map(toResource),
        nextCursor: rows.length > limit && last ? encodeResourceCursor(last) : null,
      };
    });
  }

  map(
    { tenantId }: Viewer,
    cloudAccountId: string,
    region: string | undefined,
  ): Promise<InfrastructureMap> {
    return this.database.run(tenantId, async (trx) => {
      const account = await trx
        .selectFrom('cloud_accounts')
        .select('provider')
        .where('id', '=', cloudAccountId)
        .executeTakeFirst();
      if (!account) {
        return EMPTY_MAP;
      }
      const rows = await selectResource(baseQuery(trx, { cloudAccountId, region }))
        .orderBy('resources.name')
        .limit(MAX_MAP_RESOURCES + 1)
        .execute();
      const resources = rows.slice(0, MAX_MAP_RESOURCES).map(toResource);
      const map = this.providers.get(account.provider).buildMap(resources);
      return {
        ...map,
        nodes: withDisplayNames(map.nodes, resources),
        truncated: rows.length > MAX_MAP_RESOURCES,
      };
    });
  }

  summary({ tenantId }: Viewer, filter: ResourceFilter): Promise<ResourceTypeCount[]> {
    return this.database.run(tenantId, async (trx) => {
      const rows = await baseQuery(trx, filter)
        .select(['resources.type', (eb) => eb.fn.countAll<string>().as('count')])
        .groupBy('resources.type')
        .execute();
      return rows.map(({ type, count }) => ({ type, count: Number(count) }));
    });
  }

  categories({ tenantId }: Viewer, filter: ResourceFilter): Promise<ServiceCategorySummary[]> {
    return this.database.run(tenantId, async (trx) => {
      const counts = await baseQuery(trx, filter)
        .select([
          'resources.type',
          'resources.health',
          (eb) => eb.fn.countAll<string>().as('count'),
          sql<string | null>`resources.details->>'launchType'`.as('launch_type'),
        ])
        .groupBy(['resources.type', 'resources.health', sql`resources.details->>'launchType'`])
        .execute();
      return buildCategorySummaries(counts);
    });
  }

  get({ tenantId }: Viewer, id: string): Promise<Resource> {
    return this.database.run(tenantId, async (trx) => {
      const row = await selectResource(baseQuery(trx, {}))
        .where('resources.id', '=', id)
        .executeTakeFirst();
      if (!row) {
        throw new NotFoundException('That resource no longer exists.');
      }
      return toResource(row);
    });
  }
}
