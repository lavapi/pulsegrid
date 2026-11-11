import { type ExperimentRunItem, isActiveExperiment } from '@pulsegrid/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import type { ConcurrencyLimit } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { findExperimentAccount } from './experiment-account';
import { ExperimentStarter, type StartTarget } from './experiment-starter';

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

const waitingRegions = (items: readonly ExperimentRunItem[]): string[] => [
  ...new Set(items.filter(({ waiting }) => waiting).map(({ region }) => region)),
];

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
      const items = await this.startWaiting(tenantId, { account: found.account, source }, run);
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

  private async startWaiting(tenantId: string, target: StartTarget, run: WaveRun): Promise<ExperimentRunItem[]> {
    const regions = waitingRegions(run.items);
    const capacity = await this.capacity(target, regions);
    const items = [...run.items];
    const actor = run.started_by_email ? { email: run.started_by_email } : undefined;
    for (const region of regions) {
      const room = capacity.get(region);
      let slots = room ? freeSlots(items, region, run.wave_size, room) : 0;
      for (const [index, item] of items.entries()) {
        if (slots <= 0) {
          break;
        }
        if (!item.waiting || item.region !== region) {
          continue;
        }
        const outcome = await this.starter.start({ tenantId, target, ref: item, actor });
        if (outcome.kind === 'busy') {
          break;
        }
        items[index] =
          outcome.kind === 'started'
            ? { ...item, waiting: false, experimentId: outcome.experimentId }
            : { ...item, waiting: false, error: outcome.message };
        slots -= outcome.kind === 'started' ? 1 : 0;
      }
    }
    return items;
  }
}

const waitingRuns = (trx: TenantTransaction) =>
  trx
    .selectFrom('experiment_runs')
    .select('id')
    .where(sql<boolean>`items @> ${JSON.stringify([{ waiting: true }])}::jsonb`)
    .orderBy('started_at')
    .execute();
