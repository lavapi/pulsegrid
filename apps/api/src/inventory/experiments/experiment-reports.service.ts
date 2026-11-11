import type { ExperimentReport, TestHistory, TestHistoryFilter } from '@pulsegrid/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../../auth/session/auth-context';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { type HistoryRun, historyCsv, historyEntries } from './experiment-history';
import { type ReportRow, toReport } from './experiment-report.store';
import { knownResources } from './experiment-resources';

const REPORT_MISSING = 'That report no longer exists.';
const RUN_MISSING = 'That test run no longer exists.';
const RUN_LIMIT = 300;
const REPORT_LIMIT = 1000;

export interface HistoryQuery extends Omit<TestHistoryFilter, 'from' | 'to'> {
  from?: Date;
  to?: Date;
}

const distinct = (values: readonly (string | null)[]): string[] =>
  [...new Set(values.filter((value): value is string => value !== null))].sort((a, b) => a.localeCompare(b));

const containsExperiment = (experimentId: string) =>
  sql<boolean>`items @> ${JSON.stringify([{ experimentId }])}::jsonb`;

@Injectable()
export class ExperimentReportsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  async history(auth: AuthContext, query: HistoryQuery): Promise<TestHistory> {
    const { runs, reports } = await this.database.run(auth.tenantId, (trx) => this.load(trx, query));
    const all = historyEntries(runs, reports, {});
    return {
      entries: historyEntries(runs, reports, query),
      labels: distinct(all.map(({ label }) => label)),
    };
  }

  async csv(auth: AuthContext, query: HistoryQuery): Promise<string> {
    const { runs, reports } = await this.database.run(auth.tenantId, (trx) => this.load(trx, query));
    return historyCsv(historyEntries(runs, reports, query));
  }

  async report(auth: AuthContext, id: string): Promise<ExperimentReport> {
    return this.database.run(auth.tenantId, async (trx) => {
      const row = await this.findReport(trx, id);
      const run = await trx
        .selectFrom('experiment_runs')
        .select(['id', 'label'])
        .where('cloud_account_id', '=', row.cloud_account_id)
        .where(containsExperiment(row.experiment_id))
        .executeTakeFirst();
      return toReport(row, {
        resources: await knownResources(trx, row.cloud_account_id, row.details.resourceIds),
        run: run ?? null,
      });
    });
  }

  async remove(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<void> {
    await this.database.run(auth.tenantId, async (trx) => {
      const row = await this.findReport(trx, id);
      await trx.deleteFrom('experiment_reports').where('id', '=', id).execute();
      await this.record(trx, auth, 'cloud.experiment-report.deleted', id, row.label, ipAddress);
    });
  }

  /** Deletes a group run or Run all together with the reports of its tests. */
  async removeRun(auth: AuthContext, runId: string, ipAddress: string | undefined): Promise<void> {
    await this.database.run(auth.tenantId, async (trx) => {
      const run = await trx
        .selectFrom('experiment_runs')
        .select(['id', 'label', 'items', 'cloud_account_id'])
        .where('id', '=', runId)
        .executeTakeFirst();
      if (!run) {
        throw new NotFoundException(RUN_MISSING);
      }
      const experimentIds = run.items.flatMap(({ experimentId }) => (experimentId ? [experimentId] : []));
      if (experimentIds.length > 0) {
        await trx
          .deleteFrom('experiment_reports')
          .where('cloud_account_id', '=', run.cloud_account_id)
          .where('experiment_id', 'in', experimentIds)
          .execute();
      }
      await trx.deleteFrom('experiment_runs').where('id', '=', runId).execute();
      await this.record(trx, auth, 'cloud.experiment-run.deleted', runId, run.label, ipAddress);
    });
  }

  /** One account's runs and reports: history follows the account selected in the top bar. */
  private async load(trx: TenantTransaction, { account, from, to }: HistoryQuery) {
    let runs = trx
      .selectFrom('experiment_runs')
      .innerJoin('cloud_accounts', 'cloud_accounts.id', 'experiment_runs.cloud_account_id')
      .leftJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
      .select([
        'experiment_runs.id',
        'experiment_runs.label',
        'experiment_runs.items',
        'experiment_runs.started_by_email',
        'experiment_runs.started_at',
        'experiment_runs.cloud_account_id',
        'cloud_accounts.name as account_name',
        'environments.name as environment_name',
      ])
      .where('experiment_runs.cloud_account_id', '=', account)
      .orderBy('experiment_runs.started_at', 'desc')
      .limit(RUN_LIMIT);
    let reports = trx
      .selectFrom('experiment_reports')
      .selectAll()
      .where('cloud_account_id', '=', account)
      .orderBy('started_at', 'desc')
      .limit(REPORT_LIMIT);
    if (from) {
      runs = runs.where('experiment_runs.started_at', '>=', from);
      reports = reports.where('started_at', '>=', from);
    }
    if (to) {
      runs = runs.where('experiment_runs.started_at', '<', to);
      reports = reports.where('started_at', '<', to);
    }
    const [runRows, reportRows] = await Promise.all([runs.execute(), reports.execute()]);
    return { runs: runRows satisfies HistoryRun[], reports: reportRows satisfies ReportRow[] };
  }

  private async findReport(trx: TenantTransaction, id: string): Promise<ReportRow> {
    const row = await trx.selectFrom('experiment_reports').selectAll().where('id', '=', id).executeTakeFirst();
    if (!row) {
      throw new NotFoundException(REPORT_MISSING);
    }
    return row;
  }

  private record(
    trx: TenantTransaction,
    auth: AuthContext,
    action: string,
    targetId: string,
    label: string,
    ipAddress: string | undefined,
  ): Promise<void> {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'experiment-report', id: targetId },
      ipAddress,
      metadata: { label },
    });
  }
}
