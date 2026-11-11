import {
  EXPERIMENT_RUN_LIMIT,
  type ExperimentCapacity,
  type ExperimentRunDetail,
  type ExperimentRunItem,
  type ExperimentRunItemState,
  type ExperimentRunSummary,
  type ExperimentState,
  type ExperimentTemplate,
  type ExperimentTemplateRef,
  isActiveExperiment,
  RUN_ALL_LABEL,
  type RunItemReport,
  type RunOrder,
  type StartedExperimentRun,
  type StartRunInput,
  templateKey,
  testResult,
} from '@pulsegrid/shared';
import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { experimentAccess } from './experiment-access';
import { type ExperimentTarget, ExperimentGateway } from './experiment-gateway';
import { findGroup } from './experiment-groups.service';
import { ExperimentReportStore, type ReportRow, reportKey, reportsFor } from './experiment-report.store';
import { knownResources } from './experiment-resources';
import { ExperimentWaves, inventoryOf } from './experiment-waves';
import { sharingCount } from './wave-plan';
import { runOutcome } from './run-outcome';

const RUN_MISSING = 'That test run no longer exists.';
const NOTHING_TO_RUN = 'There are no failover test templates to run.';
const TOO_MANY = `A run can start at most ${EXPERIMENT_RUN_LIMIT} templates.`;
const TEMPLATE_MISSING = 'This template no longer exists in AWS.';
const BAD_WAVE = `Choose between 1 and ${EXPERIMENT_RUN_LIMIT} tests at a time.`;
const READ_FAILED = "AWS couldn't be reached. Please try again.";
const SOME_NOT_STOPPED = "Some tests didn't stop. Please try again.";
const RECENT_RUNS = 10;

interface RunRow {
  id: string;
  label: string;
  items: ExperimentRunItem[];
  started_by_email: string | null;
  started_at: Date;
  wave_size: number | null;
}

const RUN_COLUMNS = ['id', 'label', 'items', 'started_by_email', 'started_at', 'wave_size'] as const;

const countFailed = (items: readonly ExperimentRunItem[]): number => items.filter(({ error }) => error !== null).length;

const runInfo = ({ id, label, started_by_email, started_at }: RunRow) => ({
  id,
  label,
  startedAt: started_at.toISOString(),
  startedBy: started_by_email,
});

const toSummary = (run: RunRow): ExperimentRunSummary => {
  const failed = countFailed(run.items);
  return { ...runInfo(run), started: run.items.length - failed, failed };
};

interface StartedItem {
  region: string;
  experimentId: string;
}

const startedItems = (items: readonly ExperimentRunItem[]): StartedItem[] =>
  items.flatMap(({ region, experimentId }) => (experimentId ? [{ region, experimentId }] : []));

const keyOf = ({ region, experimentId }: StartedItem): string => reportKey(region, experimentId);

const toItemReport = (row: ReportRow): RunItemReport => ({
  id: row.id,
  result: testResult(row.state) ?? 'failed',
  reason: row.reason,
  startedAt: row.started_at?.toISOString() ?? null,
  endedAt: row.ended_at?.toISOString() ?? null,
  steps: row.details.steps,
});

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof HttpException ? error.message : fallback;

export const recentRuns = async (trx: TenantTransaction, accountId: string): Promise<ExperimentRunSummary[]> => {
  const rows = await trx
    .selectFrom('experiment_runs')
    .select(RUN_COLUMNS)
    .where('cloud_account_id', '=', accountId)
    .orderBy('started_at', 'desc')
    .limit(RECENT_RUNS)
    .execute();
  return rows.map(toSummary);
};

@Injectable()
export class ExperimentRunsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly gateway: ExperimentGateway,
    private readonly reports: ExperimentReportStore,
    private readonly waves: ExperimentWaves,
  ) {}

  /** What a group or Run all will do: how many tests, how many share a resource, how many act on a whole zone. */
  async order(auth: AuthContext, accountId: string, groupId: string | undefined): Promise<RunOrder> {
    const target = await this.gateway.find(auth, accountId);
    const group = groupId ? await this.database.run(auth.tenantId, (trx) => findGroup(trx, accountId, groupId)) : null;
    const templates = await this.templates(target);
    const inventory = [...(await this.database.run(auth.tenantId, (trx) => inventoryOf(trx, accountId))).values()];
    const chosen = group
      ? group.templates.flatMap((ref) => templates.get(templateKey(ref)) ?? [])
      : [...templates.values()];
    const footprints = chosen.map((template) => target.source.footprint(template, inventory));
    return {
      tests: chosen.length,
      sharing: sharingCount(footprints),
      zoneWide: footprints.filter(({ zoneWide }) => zoneWide).length,
    };
  }

  /** For each region: how many tests AWS allows at once, and how many run now. */
  async capacity(auth: AuthContext, accountId: string): Promise<ExperimentCapacity[]> {
    const target = await this.gateway.find(auth, accountId);
    try {
      const capacity = await this.waves.capacity(target, target.account.regions);
      return [...capacity.entries()].map(([region, { limit, activeIds }]) => ({
        region,
        quota: limit.limit,
        quotaKnown: limit.known,
        running: activeIds.size,
      }));
    } catch (error) {
      throw new ConflictException(target.source.failureMessage(error));
    }
  }

  async start(
    auth: AuthContext,
    accountId: string,
    { groupId, waveSize }: StartRunInput,
    ipAddress: string | undefined,
  ): Promise<StartedExperimentRun> {
    if (!Number.isInteger(waveSize) || waveSize < 1 || waveSize > EXPERIMENT_RUN_LIMIT) {
      throw new BadRequestException(BAD_WAVE);
    }
    const target = await this.gateway.find(auth, accountId);
    const group = groupId
      ? await this.database.run(auth.tenantId, (trx) => findGroup(trx, accountId, groupId))
      : null;
    const label = group?.name ?? RUN_ALL_LABEL;
    const metadata = { label, cloudAccount: target.account.account_id };
    await this.gateway.authorize(auth, target, {
      targetType: 'experiment-run',
      targetId: groupId ?? accountId,
      ipAddress,
      metadata,
    });
    const templates = await this.templates(target);
    const wanted: ExperimentTemplateRef[] =
      group?.templates ?? [...templates.values()].map(({ id, region }) => ({ region, templateId: id }));
    if (wanted.length === 0) {
      throw new ConflictException(NOTHING_TO_RUN);
    }
    if (wanted.length > EXPERIMENT_RUN_LIMIT) {
      throw new ConflictException(TOO_MANY);
    }
    const inventory = [...(await this.database.run(auth.tenantId, (trx) => inventoryOf(trx, accountId))).values()];
    const items = wanted.map((ref): ExperimentRunItem => {
      const template = templates.get(templateKey(ref));
      if (!template) {
        return { ...ref, label: ref.templateId, experimentId: null, error: TEMPLATE_MISSING };
      }
      const { resources, zoneWide } = target.source.footprint(template, inventory);
      return { ...ref, label: template.label, experimentId: null, error: null, waiting: true, resources, zoneWide };
    });
    const id = await this.database.run(auth.tenantId, async (trx) => {
      if (group) {
        await trx.updateTable('experiment_groups').set({ wave_size: waveSize }).where('id', '=', group.id).execute();
      }
      const row = await trx
        .insertInto('experiment_runs')
        .values({
          tenant_id: auth.tenantId,
          cloud_account_id: accountId,
          label,
          items: JSON.stringify(items),
          started_by_email: auth.email,
          wave_size: waveSize,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return row.id;
    });
    await this.waves.advance(auth.tenantId, id);
    const { items: afterFirstWave } = await this.findRun(auth, accountId, id);
    await this.gateway.record(auth, {
      action: 'cloud.experiment-run.started',
      targetType: 'experiment-run',
      targetId: id,
      ipAddress,
      metadata: {
        ...metadata,
        waveSize,
        started: afterFirstWave.filter(({ experimentId }) => experimentId !== null).length,
        waiting: afterFirstWave.filter(({ waiting }) => waiting).length,
        failed: countFailed(afterFirstWave),
      },
    });
    return { id };
  }

  async detail(auth: AuthContext, accountId: string, runId: string): Promise<ExperimentRunDetail> {
    const target = await this.gateway.find(auth, accountId);
    const run = await this.findRun(auth, accountId, runId);
    const started = startedItems(run.items);
    const before = await this.saved(auth, accountId, started);
    const { states, error } = await this.liveStates(auth, target, started.filter((item) => !before.has(keyOf(item))));
    const saved = states.size > 0 ? await this.saved(auth, accountId, started) : before;
    const items = run.items.map((item): ExperimentRunItemState => {
      const report = item.experimentId ? saved.get(reportKey(item.region, item.experimentId)) : undefined;
      const live = item.experimentId ? states.get(reportKey(item.region, item.experimentId)) : undefined;
      return { ...item, state: report?.state ?? live ?? null, report: report ? toItemReport(report) : null };
    });
    const resourceIds = [...saved.values()].flatMap(({ details }) => details.resourceIds);
    return {
      ...runInfo(run),
      ...runOutcome(items),
      waveSize: run.wave_size,
      accountName: target.account.name,
      environmentName: target.environment?.name ?? null,
      items,
      resources: await this.database.run(auth.tenantId, (trx) => knownResources(trx, accountId, resourceIds)),
      access: experimentAccess(target, auth.permissions),
      error,
    };
  }

  async stop(auth: AuthContext, accountId: string, runId: string, ipAddress: string | undefined): Promise<void> {
    const target = await this.gateway.find(auth, accountId);
    const run = await this.findRun(auth, accountId, runId);
    const metadata = { label: run.label, cloudAccount: target.account.account_id };
    await this.gateway.authorize(auth, target, { targetType: 'experiment-run', targetId: runId, ipAddress, metadata });
    const { cancelled, items } = await this.cancelWaiting(auth, runId);
    const { states, error } = await this.liveStates(auth, target, startedItems(items));
    if (error) {
      throw new ConflictException(error);
    }
    const active = startedItems(items).filter((item) => {
      const state = states.get(keyOf(item));
      return state !== undefined && isActiveExperiment(state);
    });
    const results = await Promise.allSettled(
      active.map(({ region, experimentId }) => this.gateway.stop(auth, target, region, experimentId, ipAddress)),
    );
    const failed = results.filter(({ status }) => status === 'rejected').length;
    await this.gateway.record(auth, {
      action: 'cloud.experiment-run.stopped',
      targetType: 'experiment-run',
      targetId: runId,
      ipAddress,
      metadata: { ...metadata, stopped: active.length - failed, failed, cancelled },
    });
    if (failed > 0) {
      throw new ConflictException(SOME_NOT_STOPPED);
    }
  }

  /** Cancels the tests still waiting for a slot, so no new wave starts. Waits for a wave being started to finish first. */
  private cancelWaiting(auth: AuthContext, runId: string): Promise<{ cancelled: number; items: ExperimentRunItem[] }> {
    return this.database.run(auth.tenantId, async (trx) => {
      const run = await trx
        .selectFrom('experiment_runs')
        .select('items')
        .where('id', '=', runId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const cancelled = run.items.filter(({ waiting }) => waiting).length;
      const items = run.items.map((item) => (item.waiting ? { ...item, waiting: false, cancelled: true } : item));
      if (cancelled > 0) {
        await trx.updateTable('experiment_runs').set({ items: JSON.stringify(items) }).where('id', '=', runId).execute();
      }
      return { cancelled, items };
    });
  }

  private async templates(target: ExperimentTarget): Promise<Map<string, ExperimentTemplate>> {
    const perRegion = await Promise.all(
      target.account.regions.map((region) =>
        this.gateway.call(target, region, (source, context) => source.listTemplates(context)),
      ),
    );
    return new Map(
      perRegion.flat().map((template) => [templateKey({ region: template.region, templateId: template.id }), template]),
    );
  }

  private saved(auth: AuthContext, accountId: string, items: readonly StartedItem[]) {
    return this.database.run(auth.tenantId, (trx) =>
      reportsFor(trx, accountId, items.map(({ experimentId }) => experimentId)),
    );
  }

  /** Live states from AWS, saving the report of any test that has ended since. */
  private async liveStates(
    auth: AuthContext,
    target: ExperimentTarget,
    items: readonly StartedItem[],
  ): Promise<{ states: Map<string, ExperimentState>; error: string | null }> {
    const states = new Map<string, ExperimentState>();
    try {
      const regions = [...new Set(items.map(({ region }) => region))];
      const listed = await Promise.all(
        regions.map((region) => this.gateway.call(target, region, (source, context) => source.listExperiments(context))),
      );
      for (const { region, id, state } of listed.flat()) {
        states.set(reportKey(region, id), state);
      }
      const unsettled = items.filter((item) => {
        const state = states.get(keyOf(item));
        return state === undefined || !isActiveExperiment(state);
      });
      const records = await Promise.all(
        unsettled.map(({ region, experimentId }) =>
          this.gateway.call(target, region, (source, context) => source.getExperiment(context, experimentId)),
        ),
      );
      for (const record of records.filter((item) => item !== null)) {
        states.set(reportKey(record.region, record.id), record.state);
        await this.reports.save(auth.tenantId, target, record);
      }
      return { states, error: null };
    } catch (error) {
      return { states, error: messageOf(error, READ_FAILED) };
    }
  }

  private async findRun(auth: AuthContext, accountId: string, runId: string): Promise<RunRow> {
    const run = await this.database.run(auth.tenantId, (trx) =>
      trx
        .selectFrom('experiment_runs')
        .select(RUN_COLUMNS)
        .where('cloud_account_id', '=', accountId)
        .where('id', '=', runId)
        .executeTakeFirst(),
    );
    if (!run) {
      throw new NotFoundException(RUN_MISSING);
    }
    return run;
  }
}
