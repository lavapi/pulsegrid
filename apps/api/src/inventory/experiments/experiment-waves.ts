import { type ExperimentRunItem, isActiveExperiment } from '@pulsegrid/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import type { ConcurrencyLimit, InventoryItem } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { findExperimentAccount } from './experiment-account';
import { ExperimentStarter, type StartTarget } from './experiment-starter';
import { parseKey } from './resource-keys';
import { NOTES, planWave, RECOVERY_TIMEOUT_MS, SETTLE_MS } from './wave-plan';

export interface RegionCapacity {
  limit: ConcurrencyLimit;
  /** IDs of every test running in the account and region, including ones started elsewhere. */
  activeIds: Set<string>;
}

interface WaveRun {
  id: string;
  items: ExperimentRunItem[];
  wave_size: number | null;
  started_by_email: string | null;
}

/** Room for more of this run's tests: what's left of its wave, and of the account's quota. */
export const freeSlots = (
  items: readonly ExperimentRunItem[],
  region: string,
  waveSize: number | null,
  { limit, activeIds }: RegionCapacity,
): number => {
  const runActive = items.filter(
    (item) => item.region === region && item.experimentId !== null && activeIds.has(item.experimentId),
  ).length;
  return Math.min((waveSize ?? Number.POSITIVE_INFINITY) - runActive, limit.limit - activeIds.size);
};

/** Runs a group or Run all in waves: starts waiting tests while the run's wave size and AWS's quota leave room. */
@Injectable()
export class ExperimentWaves {
  private readonly logger = new Logger(ExperimentWaves.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    private readonly starter: ExperimentStarter,
  ) {}

  /** The quota and the tests running now, for each region. Throws what the provider throws. */
  async capacity({ account, source }: StartTarget, regions: readonly string[]): Promise<Map<string, RegionCapacity>> {
    const credentials = this.vault.open(account);
    if (!credentials) {
      return new Map();
    }
    const entries = await Promise.all(
      regions.map(async (region) => {
        const context = { credentials, region };
        const [limit, experiments] = await Promise.all([
          source.concurrencyLimit(context),
          source.listExperiments(context),
        ]);
        const activeIds = new Set(experiments.filter(({ state }) => isActiveExperiment(state)).map(({ id }) => id));
        return [region, { limit, activeIds }] as const;
      }),
    );
    return new Map(entries);
  }

  /** Starts what fits of a run's waiting tests. A run another process is advancing is skipped. */
  async advance(tenantId: string, runId: string): Promise<void> {
    await this.database.run(tenantId, async (trx) => {
      const run = await trx
        .selectFrom('experiment_runs')
        .select(['id', 'items', 'wave_size', 'started_by_email', 'cloud_account_id'])
        .where('id', '=', runId)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!run || !run.items.some(({ waiting }) => waiting)) {
        return;
      }
      const found = await findExperimentAccount(trx, run.cloud_account_id);
      const source = found && this.providers.get(found.account.provider).experimentSource;
      if (!found || !source) {
        return;
      }
      const inventory = await inventoryOf(trx, run.cloud_account_id);
      const items = await this.startWaiting(tenantId, { account: found.account, source }, run, inventory);
      await trx.updateTable('experiment_runs').set({ items: JSON.stringify(items) }).where('id', '=', runId).execute();
    });
  }

  /** Advances every run with waiting tests, in every project. */
  async advanceAll(): Promise<void> {
    const tenants = await this.db.selectFrom('tenants').select('id').execute();
    for (const { id: tenantId } of tenants) {
      const runs = await this.database.run(tenantId, (trx) => waitingRuns(trx));
      for (const { id } of runs) {
        await this.advance(tenantId, id).catch((error: unknown) => {
          this.logger.warn(`Advancing a test run failed: ${(error as Error).name}`);
        });
      }
    }
  }

  private async startWaiting(
    tenantId: string,
    target: StartTarget,
    run: WaveRun,
    inventory: ReadonlyMap<string, InventoryItem>,
  ): Promise<ExperimentRunItem[]> {
    const now = Date.now();
    const regions = [...new Set(run.items.map(({ region }) => region))];
    const capacity = await this.capacity(target, regions);
    const seen = run.items.map((item) => noteEnd(item, capacity, now));
    const items = await Promise.all(seen.map((item) => this.checkRecovery(target, item, inventory, now)));
    const rooms = new Map(
      [...capacity].map(([region, room]) => [region, { slots: freeSlots(items, region, run.wave_size, room), activeIds: room.activeIds }]),
    );
    const plan = planWave(items, rooms);
    const actor = run.started_by_email ? { email: run.started_by_email } : undefined;
    const next = items.map((item, index): ExperimentRunItem => {
      const cancelled = plan.cancel.get(index);
      if (cancelled) {
        return { ...item, waiting: false, cancelled: true, note: cancelled };
      }
      return item.waiting ? { ...item, note: plan.notes.get(index) ?? null } : item;
    });
    const full = new Set<string>();
    for (const index of plan.start) {
      const item = next[index] as ExperimentRunItem;
      if (full.has(item.region)) {
        next[index] = { ...item, note: NOTES.slot };
        continue;
      }
      const outcome = await this.starter.start({ tenantId, target, ref: item, actor });
      if (outcome.kind === 'busy') {
        full.add(item.region);
      }
      next[index] =
        outcome.kind === 'started'
          ? { ...item, waiting: false, note: null, experimentId: outcome.experimentId }
          : outcome.kind === 'busy'
            ? { ...item, note: NOTES.slot }
            : { ...item, waiting: false, note: null, error: outcome.message };
    }
    return next;
  }

  /** Marks a test's resources recovered once it has settled and AWS says each is healthy, or failed after 30 minutes. */
  private async checkRecovery(
    { account, source }: StartTarget,
    item: ExperimentRunItem,
    inventory: ReadonlyMap<string, InventoryItem>,
    now: number,
  ): Promise<ExperimentRunItem> {
    if (!item.endedAt || item.recovered !== undefined) {
      return item;
    }
    const since = now - Date.parse(item.endedAt);
    if (since < SETTLE_MS) {
      return item;
    }
    const credentials = this.vault.open(account);
    const resources = (item.resources ?? []).flatMap(({ key }) => inventory.get(parseKey(key).id) ?? []);
    const checks = credentials
      ? await Promise.all(resources.map((resource) => source.isRecovered({ credentials, region: item.region }, resource)))
      : [];
    if (checks.every((healthy) => healthy !== false)) {
      return { ...item, recovered: true };
    }
    return since > RECOVERY_TIMEOUT_MS ? { ...item, recovered: false } : item;
  }
}

/** Notes when a started test is no longer running, which starts its settling time. */
const noteEnd = (item: ExperimentRunItem, capacity: ReadonlyMap<string, RegionCapacity>, now: number): ExperimentRunItem => {
  const running = item.experimentId !== null && (capacity.get(item.region)?.activeIds.has(item.experimentId) ?? false);
  return item.experimentId === null || running || item.endedAt ? item : { ...item, endedAt: new Date(now).toISOString() };
};

/** The account's resources PulseGrid knows, by ID: what failover tests are matched against. */
export const inventoryOf = async (trx: TenantTransaction, accountId: string): Promise<Map<string, InventoryItem>> => {
  const rows = await trx
    .selectFrom('resources')
    .select(['id', 'type', 'native_id', 'name', 'tags', 'details'])
    .where('cloud_account_id', '=', accountId)
    .execute();
  return new Map(
    rows.map(({ id, type, native_id: nativeId, name, tags, details }) => [id, { id, type, nativeId, name, tags, details }]),
  );
};

const waitingRuns = (trx: TenantTransaction) =>
  trx
    .selectFrom('experiment_runs')
    .select('id')
    .where(sql<boolean>`items @> ${JSON.stringify([{ waiting: true }])}::jsonb`)
    .orderBy('started_at')
    .execute();
