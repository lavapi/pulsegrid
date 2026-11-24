import { CARD_LOAD_SLOTS, type CardLoadMap, type LoadChart, type ResourceType } from '@pulsegrid/shared';
import { Injectable, Logger } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import type { Selectable } from 'kysely';
import type { CloudAccountRow, ResourcesTable } from '../../database/schema';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import { ProviderRegistry } from '../providers/provider-registry';

const CACHE_MS = 60_000;
const MAX_CACHED = 200;

const chartIdsOf = (type: ResourceType): readonly string[] => (CARD_LOAD_SLOTS[type] ?? []).flat();

type CardResource = Pick<Selectable<ResourcesTable>, 'id' | 'type' | 'name' | 'native_id' | 'region' | 'details' | 'cloud_account_id'>;

/** Resources read together: one account's key, in one region. */
interface Batch {
  account: CloudAccountRow;
  region: string;
  resources: CardResource[];
}

const batchesOf = (resources: readonly CardResource[], accounts: ReadonlyMap<string, CloudAccountRow>): Batch[] => {
  const batches = new Map<string, Batch>();
  for (const resource of resources) {
    const account = accounts.get(resource.cloud_account_id);
    if (!account) continue;
    const key = `${account.id}/${resource.region}`;
    const batch = batches.get(key) ?? { account, region: resource.region, resources: [] };
    batch.resources.push(resource);
    batches.set(key, batch);
  }
  return [...batches.values()];
};

/**
 * The latest load for many resource cards in one go: one CloudWatch read per account and region, kept for a minute
 * so a page refreshing, or several people on it, cost one read.
 */
@Injectable()
export class CardLoadService {
  private readonly logger = new Logger(CardLoadService.name);
  private readonly cache = new Map<string, { charts: CardLoadMap; until: number }>();

  constructor(
    private readonly database: TenantDatabase,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
  ) {}

  async read(auth: AuthContext, ids: readonly string[], now = Date.now()): Promise<CardLoadMap> {
    const { resources, accounts } = await this.load(auth, ids);
    const loads = await Promise.all(batchesOf(resources, accounts).map((batch) => this.readBatch(batch, now)));
    return Object.assign({}, ...loads) as CardLoadMap;
  }

  private load(auth: AuthContext, ids: readonly string[]) {
    return this.database.run(auth.tenantId, async (trx) => {
      const types = Object.keys(CARD_LOAD_SLOTS) as ResourceType[];
      const resources =
        ids.length === 0
          ? []
          : await trx
              .selectFrom('resources')
              .select(['id', 'type', 'name', 'native_id', 'region', 'details', 'cloud_account_id'])
              .where('id', 'in', ids)
              .where('type', 'in', types)
              .execute();
      const accountIds = [...new Set(resources.map(({ cloud_account_id }) => cloud_account_id))];
      const accounts =
        accountIds.length === 0
          ? []
          : await trx.selectFrom('cloud_accounts').selectAll().where('id', 'in', accountIds).execute();
      return { resources, accounts: new Map(accounts.map((account) => [account.id, account])) };
    });
  }

  private async readBatch({ account, region, resources }: Batch, now: number): Promise<CardLoadMap> {
    const key = `${account.id}/${region}/${resources.map(({ id }) => id).sort().join(',')}`;
    const cached = this.cache.get(key);
    if (cached && cached.until > now) {
      return cached.charts;
    }
    const source = this.providers.get(account.provider).metricSource;
    const credentials = this.vault.open(account);
    if (!source?.readLatest || !credentials) {
      return {};
    }
    try {
      const results = await source.readLatest(
        {
          credentials,
          region,
          resources: resources.map(({ type, name, native_id: nativeId, details }) => ({ type, name, nativeId, details })),
        },
        chartIdsOf,
      );
      const charts: CardLoadMap = Object.fromEntries(
        resources.flatMap((resource, index): [string, LoadChart[]][] => {
          const result = results[index];
          return result ? [[resource.id, result.charts]] : [];
        }),
      );
      this.remember(key, charts, now);
      return charts;
    } catch (error) {
      this.logger.warn(`Card load read failed: ${(error as Error).name}`);
      return {};
    }
  }

  private remember(key: string, charts: CardLoadMap, now: number): void {
    if (this.cache.size >= MAX_CACHED) {
      this.cache.clear();
    }
    this.cache.set(key, { charts, until: now + CACHE_MS });
  }
}
