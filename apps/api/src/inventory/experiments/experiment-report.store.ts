import { type ExperimentReport, type ExperimentReportDetails, testResult } from '@pulsegrid/shared';
import { Injectable } from '@nestjs/common';
import type { Selectable } from 'kysely';
import type { ExperimentReportsTable } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import type { ExperimentRecord } from '../providers/provider';
import type { ExperimentAccount } from './experiment-account';
import { startedBy } from './experiment-audit';

export type ReportRow = Selectable<ExperimentReportsTable>;

export const reportKey = (region: string, experimentId: string): string => `${region}/${experimentId}`;

const isoOf = (date: Date | null): string | null => date?.toISOString() ?? null;

export const toReport = (
  row: ReportRow,
  extra: Pick<ExperimentReport, 'resources' | 'run'>,
): ExperimentReport => ({
  id: row.id,
  experimentId: row.experiment_id,
  region: row.region,
  templateId: row.template_id,
  label: row.label,
  description: row.details.description,
  accountId: row.cloud_account_id,
  accountName: row.account_name,
  environmentName: row.environment_name,
  production: row.is_production,
  startedBy: row.started_by_email,
  startedAt: isoOf(row.started_at),
  endedAt: isoOf(row.ended_at),
  state: row.state,
  result: testResult(row.state) ?? 'failed',
  reason: row.reason,
  steps: row.details.steps,
  targets: row.details.targets,
  stopAlarms: row.details.stopAlarms,
  ...extra,
});

/** Saved reports for these tests, by region and experiment ID. */
export const reportsFor = async (
  trx: TenantTransaction,
  accountId: string,
  experimentIds: readonly string[],
): Promise<Map<string, ReportRow>> => {
  if (experimentIds.length === 0) {
    return new Map();
  }
  const rows = await trx
    .selectFrom('experiment_reports')
    .selectAll()
    .where('cloud_account_id', '=', accountId)
    .where('experiment_id', 'in', [...new Set(experimentIds)])
    .execute();
  return new Map(rows.map((row) => [reportKey(row.region, row.experiment_id), row]));
};

const detailsOf = ({ description, steps, targets, stopAlarms, resolvedResourceIds }: ExperimentRecord) => {
  const listed = targets.flatMap(({ resourceIds }) => resourceIds);
  const details: ExperimentReportDetails = {
    description,
    steps,
    targets,
    stopAlarms,
    resourceIds: [...new Set([...resolvedResourceIds, ...listed])],
  };
  return JSON.stringify(details);
};

@Injectable()
export class ExperimentReportStore {
  constructor(private readonly database: TenantDatabase) {}

  /** Saves the report of an ended test once; active tests and tests already saved are left alone. */
  async save(tenantId: string, { account, environment }: ExperimentAccount, record: ExperimentRecord): Promise<void> {
    if (!testResult(record.state)) {
      return;
    }
    await this.database.run(tenantId, async (trx) => {
      await trx
        .insertInto('experiment_reports')
        .values({
          tenant_id: tenantId,
          cloud_account_id: account.id,
          region: record.region,
          experiment_id: record.id,
          template_id: record.templateId,
          label: record.label,
          account_name: account.name,
          environment_name: environment?.name ?? null,
          is_production: environment?.isProduction ?? true,
          started_by_email: await startedBy(trx, record.id),
          state: record.state,
          reason: record.reason,
          started_at: record.startedAt ? new Date(record.startedAt) : null,
          ended_at: record.endedAt ? new Date(record.endedAt) : null,
          details: detailsOf(record),
        })
        .onConflict((conflict) => conflict.columns(['cloud_account_id', 'region', 'experiment_id']).doNothing())
        .execute();
    });
  }
}
