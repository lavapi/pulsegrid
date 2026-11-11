import {
  EXPERIMENT_RUN_LIMIT,
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
  type StartedExperimentRun,
  templateKey,
  testResult,
} from '@pulsegrid/shared';
import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { experimentAccess } from './experiment-access';
import { type ExperimentTarget, ExperimentGateway } from './experiment-gateway';
import { findGroup } from './experiment-groups.service';
import { ExperimentReportStore, type ReportRow, reportKey, reportsFor } from './experiment-report.store';
import { knownResources } from './experiment-resources';
import { runOutcome } from './run-outcome';

const RUN_MISSING = 'That test run no longer exists.';
const NOTHING_TO_RUN = 'There are no failover test templates to run.';
const TOO_MANY = `A run can start at most ${EXPERIMENT_RUN_LIMIT} templates.`;
const TEMPLATE_MISSING = 'This template no longer exists in AWS.';
const START_FAILED = "This test didn't start. Please try again.";
const READ_FAILED = "AWS couldn't be reached. Please try again.";
const SOME_NOT_STOPPED = "Some tests didn't stop. Please try again.";
const RECENT_RUNS = 10;

interface RunRow {
  id: string;
  label: string;
  items: ExperimentRunItem[];
  started_by_email: string | null;
  started_at: Date;
}

const RUN_COLUMNS = ['id', 'label', 'items', 'started_by_email', 'started_at'] as const;

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
  ) {}

  async start(
    auth: AuthContext,
    accountId: string,
    groupId: string | undefined,
    ipAddress: string | undefined,
  ): Promise<StartedExperimentRun> {
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
    const items = await Promise.all(
      wanted.map((ref) => this.startItem(auth, target, ref, templates.get(templateKey(ref)), ipAddress)),
    );
    const { id } = await this.database.run(auth.tenantId, (trx) =>
      trx
        .insertInto('experiment_runs')
        .values({
          tenant_id: auth.tenantId,
          cloud_account_id: accountId,
          label,
          items: JSON.stringify(items),
          started_by_email: auth.email,
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    const failed = countFailed(items);
    await this.gateway.record(auth, {
      action: 'cloud.experiment-run.started',
      targetType: 'experiment-run',
      targetId: id,
      ipAddress,
      metadata: { ...metadata, started: items.length - failed, failed },
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
    const { states, error } = await this.liveStates(auth, target, startedItems(run.items));
    if (error) {
      throw new ConflictException(error);
    }
    const active = startedItems(run.items).filter((item) => {
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
      metadata: { ...metadata, stopped: active.length - failed, failed },
    });
    if (failed > 0) {
      throw new ConflictException(SOME_NOT_STOPPED);
    }
  }

  private async startItem(
    auth: AuthContext,
    target: ExperimentTarget,
    ref: ExperimentTemplateRef,
    template: ExperimentTemplate | undefined,
    ipAddress: string | undefined,
  ): Promise<ExperimentRunItem> {
    if (!template) {
      return { ...ref, label: ref.templateId, experimentId: null, error: TEMPLATE_MISSING };
    }
    try {
      const experimentId = await this.gateway.start(auth, target, ref, ipAddress);
      return { ...ref, label: template.label, experimentId, error: null };
    } catch (error) {
      return { ...ref, label: template.label, experimentId: null, error: messageOf(error, START_FAILED) };
    }
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
