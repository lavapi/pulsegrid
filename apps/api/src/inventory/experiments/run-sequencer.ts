import { type ExperimentRunItem, isActiveExperiment } from '@pulsegrid/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { DATABASE } from '../../database/database.module';
import type { CloudAccountRow, Database } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import type { CloudCredentials, ExperimentSource, InventoryItem } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { EnvironmentLock } from './environment-lock';
import { findExperimentAccount } from './experiment-account';
import { ExperimentReportStore } from './experiment-report.store';
import { ExperimentStarter } from './experiment-starter';
import { parseKey } from './resource-keys';

/** How long the environment may stay unhealthy, before or after a test, before the run stops. */
export const HEALTH_TIMEOUT_MS = 30 * 60_000;
const FAILED_STATES = ['failed', 'stopped'];

export const NOTES = {
  previous: 'Waiting for the previous test to end and the environment to be healthy again.',
  unhealthy: (problems: readonly string[]) => `Waiting for the environment to be healthy: ${problems.join('; ')}`,
  busy: (what: string) => `Waiting: ${what}`,
  stopped: 'Not run: the run stopped before it.',
  quota: 'Waiting: AWS is already running as many experiments as it allows.',
};

const stopReason = (when: string, problems: readonly string[]) =>
  `Stopped: the environment wasn't healthy 30 minutes ${when}. ${problems.join('; ')}.`;

interface SequenceRun {
  id: string;
  label: string;
  items: ExperimentRunItem[];
  started_by_email: string | null;
  cloud_account_id: string;
}

interface Step {
  account: CloudAccountRow;
  source: ExperimentSource;
  credentials: CloudCredentials;
  inventory: InventoryItem[];
  alarms: string[];
  now: number;
}

const since = (iso: string | null | undefined, now: number): number => (iso ? now - Date.parse(iso) : 0);

/** Zone-wide tests run after every other test. */
export const nextWaiting = (items: readonly ExperimentRunItem[]): number => {
  const waiting = items.flatMap((item, index) => (item.waiting ? [{ item, index }] : []));
  return (waiting.find(({ item }) => !item.zoneWide) ?? waiting[0])?.index ?? -1;
};

const nameOf = (id: string, inventory: readonly InventoryItem[]): string => {
  const instanceId = id.split('/').at(-1) ?? id;
  const known = inventory.find(({ nativeId }) => nativeId === instanceId || nativeId === id);
  return known && known.name !== instanceId ? `${known.name} (${instanceId})` : instanceId;
};

/**
 * Runs a group or Run all strictly one test at a time. The next test starts only after the previous one has ended
 * and the whole environment is healthy again, and only when nothing else is running in the environment. Tests whose
 * targets aren't ready are skipped with the reason. Servers a failed test left stopped are started again.
 */
@Injectable()
export class RunSequencer {
  private readonly logger = new Logger(RunSequencer.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    private readonly starter: ExperimentStarter,
    private readonly reports: ExperimentReportStore,
    private readonly lock: EnvironmentLock,
  ) {}

  /** Moves a run on by one step. A run another process is moving on is skipped. */
  async advance(tenantId: string, runId: string): Promise<void> {
    await this.database.run(tenantId, async (trx) => {
      const run = await trx
        .selectFrom('experiment_runs')
        .select(['id', 'label', 'items', 'started_by_email', 'cloud_account_id', 'stopped_reason'])
        .where('id', '=', runId)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!run || run.stopped_reason || !run.items.some(({ waiting, settling }) => waiting || settling)) {
        return;
      }
      const found = await findExperimentAccount(trx, run.cloud_account_id);
      const source = found && this.providers.get(found.account.provider).experimentSource;
      const credentials = found && this.vault.open(found.account);
      if (!found || !source || !credentials) {
        return;
      }
      const step: Step = {
        account: found.account,
        source,
        credentials,
        inventory: await inventoryIn(trx, run.cloud_account_id),
        alarms: [...new Set(run.items.flatMap(({ alarms = [] }) => alarms))],
        now: Date.now(),
      };
      const { items, stoppedReason } = await this.step(tenantId, trx, run, step, found);
      await trx
        .updateTable('experiment_runs')
        .set({ items: JSON.stringify(items), stopped_reason: stoppedReason })
        .where('id', '=', runId)
        .execute();
    });
  }

  /** Moves on every unfinished run, in every project. */
  async advanceAll(): Promise<void> {
    const tenants = await this.db.selectFrom('tenants').select('id').execute();
    for (const { id: tenantId } of tenants) {
      const runs = await this.database.run(tenantId, (trx) => unfinishedRuns(trx));
      for (const { id } of runs) {
        await this.advance(tenantId, id).catch((error: unknown) => {
          this.logger.warn(`Moving a test run on failed: ${(error as Error).name}`);
        });
      }
    }
  }

  private async step(
    tenantId: string,
    trx: TenantTransaction,
    run: SequenceRun,
    step: Step,
    found: NonNullable<Awaited<ReturnType<typeof findExperimentAccount>>>,
  ): Promise<{ items: ExperimentRunItem[]; stoppedReason: string | null }> {
    const items = [...run.items];
    const current = items.findIndex(({ settling }) => settling);
    if (current >= 0) {
      const settled = await this.settle(tenantId, items[current] as ExperimentRunItem, step, found);
      items[current] = settled.item;
      if (settled.stop) {
        return { items: cancelWaiting(items), stoppedReason: settled.stop };
      }
      if (settled.item.settling) {
        return { items: noteWaiting(items, settled.note ?? NOTES.previous), stoppedReason: null };
      }
    }
    return this.startNext(tenantId, trx, run, items, step);
  }

  /** Follows the test that ran last: its end, any servers to start again, then the environment's health. */
  private async settle(
    tenantId: string,
    item: ExperimentRunItem,
    { source, credentials, inventory, alarms, now }: Step,
    found: NonNullable<Awaited<ReturnType<typeof findExperimentAccount>>>,
  ): Promise<{ item: ExperimentRunItem; stop?: string; note?: string }> {
    const context = { credentials, region: item.region };
    let next = item;
    if (!next.endedAt && next.experimentId) {
      const record = await source.getExperiment(context, next.experimentId);
      if (record && isActiveExperiment(record.state)) {
        return { item: next, note: NOTES.previous };
      }
      if (record) {
        await this.reports.save(tenantId, found, record);
      }
      const endedBadly = !record || FAILED_STATES.includes(record.state);
      next = {
        ...next,
        endedAt: record?.endedAt ?? new Date(now).toISOString(),
        repairPending: Boolean(next.stopsInstances && endedBadly),
      };
    }
    if (next.repairPending && next.experimentId) {
      next = await this.repair(next, context, source, inventory, now);
      if (next.repairPending) {
        return { item: next, note: NOTES.previous };
      }
    }
    const problems = await source.environmentHealth(context, inventory.filter(inRegion(item.region)), alarms);
    if (problems.length === 0) {
      return { item: { ...next, settling: false, healthyAt: new Date(now).toISOString() } };
    }
    if (since(next.endedAt, now) > HEALTH_TIMEOUT_MS) {
      return { item: { ...next, settling: false }, stop: stopReason(`after ${item.label}`, problems) };
    }
    return { item: next, note: NOTES.unhealthy(problems) };
  }

  /** Starts the servers a test left stopped, waiting while they're still stopping, for up to 30 minutes. */
  private async repair(
    item: ExperimentRunItem,
    context: { credentials: CloudCredentials; region: string },
    source: ExperimentSource,
    inventory: readonly InventoryItem[],
    now: number,
  ): Promise<ExperimentRunItem> {
    const targets = await source.resolvedTargets(context, item.experimentId as string);
    const { started, waiting } = await source.restartStopped(context, targets);
    const repairs = [
      ...(item.repairs ?? []),
      ...started.map((id) => ({ at: new Date(now).toISOString(), text: `Started ${nameOf(id, inventory)} again` })),
    ];
    if (waiting.length === 0) {
      return { ...item, repairs, repairPending: false };
    }
    if (since(item.endedAt, now) > HEALTH_TIMEOUT_MS) {
      const left = waiting.map((id) => ({ at: null, text: `Couldn't start ${nameOf(id, inventory)} again; start it by hand` }));
      return { ...item, repairs: [...repairs, ...left], repairPending: false };
    }
    return { ...item, repairs };
  }

  /** Starts the next waiting test, or skips it, once the environment is free and healthy. */
  private async startNext(
    tenantId: string,
    trx: TenantTransaction,
    run: SequenceRun,
    items: ExperimentRunItem[],
    { account, source, credentials, inventory, alarms, now }: Step,
  ): Promise<{ items: ExperimentRunItem[]; stoppedReason: string | null }> {
    let index = nextWaiting(items);
    while (index >= 0) {
      const item = items[index] as ExperimentRunItem;
      const context = { credentials, region: item.region };
      await this.lock.hold(trx, account);
      const busy = await this.lock.busy(trx, account, run.id);
      if (busy) {
        return { items: noteWaiting(items, NOTES.busy(busy)), stoppedReason: null };
      }
      const problems = await source.environmentHealth(context, inventory.filter(inRegion(item.region)), alarms);
      if (problems.length > 0) {
        const gateSince = item.gateSince ?? new Date(now).toISOString();
        if (since(gateSince, now) > HEALTH_TIMEOUT_MS) {
          return { items: cancelWaiting(items), stoppedReason: stopReason(`before ${item.label}`, problems) };
        }
        items[index] = { ...item, gateSince };
        return { items: noteWaiting(items, NOTES.unhealthy(problems)), stoppedReason: null };
      }
      const skipped = await this.notReady(item, context, source, inventory);
      if (skipped) {
        items[index] = { ...item, waiting: false, skipped, note: null };
        index = nextWaiting(items);
        continue;
      }
      const actor = run.started_by_email ? { email: run.started_by_email } : undefined;
      const outcome = await this.starter.start({ tenantId, target: { account, source }, ref: item, actor });
      items[index] =
        outcome.kind === 'started'
          ? {
              ...item,
              waiting: false,
              settling: true,
              note: null,
              experimentId: outcome.experimentId,
              startedAt: new Date(now).toISOString(),
            }
          : outcome.kind === 'busy'
            ? { ...item, note: NOTES.quota }
            : { ...item, waiting: false, note: null, error: outcome.message };
      return { items: noteWaiting(items, NOTES.previous), stoppedReason: null };
    }
    return { items, stoppedReason: null };
  }

  /** Why a test's targets aren't ready, such as a cache that isn't available or a service with one task. */
  private async notReady(
    item: ExperimentRunItem,
    context: { credentials: CloudCredentials; region: string },
    source: ExperimentSource,
    inventory: readonly InventoryItem[],
  ): Promise<string | null> {
    const byId = new Map(inventory.map((resource) => [resource.id, resource]));
    const footprint = {
      resources: item.resources ?? [],
      zoneWide: item.zoneWide ?? false,
      stopsInstances: item.stopsInstances ?? false,
      needsSpareTask: item.needsSpareTask ?? false,
    };
    const targets = footprint.resources.flatMap(({ key }) => byId.get(parseKey(key).id) ?? []);
    const reasons = await Promise.all(targets.map((resource) => source.notReady(context, resource, footprint)));
    const found = reasons.filter((reason): reason is string => reason !== null);
    return found.length > 0 ? found.join('; ') : null;
  }
}

const inRegion =
  (region: string) =>
  (resource: InventoryItem): boolean =>
    resource.region === region;

/** Notes why the tests still waiting are waiting; the next one gets the reason, the rest wait their turn. */
const noteWaiting = (items: readonly ExperimentRunItem[], note: string): ExperimentRunItem[] => {
  const next = nextWaiting(items);
  return items.map((item, index) => {
    if (!item.waiting) {
      return item;
    }
    return { ...item, note: index === next ? note : item.zoneWide ? 'Zone-wide: runs after every other test.' : 'Waiting its turn.' };
  });
};

const cancelWaiting = (items: readonly ExperimentRunItem[]): ExperimentRunItem[] =>
  items.map((item) => (item.waiting ? { ...item, waiting: false, cancelled: true, note: NOTES.stopped } : item));

/** The account's resources PulseGrid knows, with their region: what failover tests are matched and checked against. */
export const inventoryIn = async (trx: TenantTransaction, accountId: string): Promise<InventoryItem[]> => {
  const rows = await trx
    .selectFrom('resources')
    .select(['id', 'type', 'native_id', 'name', 'tags', 'details', 'region'])
    .where('cloud_account_id', '=', accountId)
    .execute();
  return rows.map(({ id, type, native_id: nativeId, name, tags, details, region }) => ({
    id,
    type,
    nativeId,
    name,
    tags,
    details,
    region,
  }));
};

const unfinishedRuns = (trx: TenantTransaction) =>
  trx
    .selectFrom('experiment_runs')
    .select('id')
    .where('stopped_reason', 'is', null)
    .where((eb) =>
      eb.or([
        sql<boolean>`items @> ${JSON.stringify([{ waiting: true }])}::jsonb`,
        sql<boolean>`items @> ${JSON.stringify([{ settling: true }])}::jsonb`,
      ]),
    )
    .orderBy('started_at')
    .execute();
