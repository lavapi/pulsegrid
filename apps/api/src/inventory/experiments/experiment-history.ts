import {
  type ExperimentRunItem,
  type RunCounts,
  type TestHistoryEntry,
  type TestHistoryFilter,
  testResult,
} from '@pulsegrid/shared';
import { type ReportRow, reportKey } from './experiment-report.store';
import { didNotStart, type OutcomeItem, runOutcome } from './run-outcome';

/** AWS stops every test within 12 hours, so a run older than that with a missing result has lost it. */
const LONGEST_TEST_MS = 12 * 60 * 60 * 1000;

export interface HistoryRun {
  id: string;
  label: string;
  items: ExperimentRunItem[];
  started_by_email: string | null;
  started_at: Date;
  cloud_account_id: string;
  account_name: string;
  environment_name: string | null;
}

const countsOf = (items: readonly OutcomeItem[]): RunCounts => {
  const results = items.flatMap(({ report }) => (report ? [report.result] : []));
  const count = (result: string) => results.filter((item) => item === result).length;
  return {
    total: items.length,
    passed: count('passed'),
    stopped: count('stopped'),
    failed: count('failed'),
    notStarted: items.filter(didNotStart).length,
    waiting: items.filter(({ waiting }) => waiting).length,
    cancelled: items.filter(({ cancelled }) => cancelled).length,
  };
};

const runEntry = (run: HistoryRun, reports: ReadonlyMap<string, ReportRow>, now: Date): TestHistoryEntry => {
  const recent = now.getTime() - run.started_at.getTime() < LONGEST_TEST_MS;
  const items = run.items.map(({ region, experimentId, waiting, cancelled }): OutcomeItem => {
    const report = experimentId ? reports.get(reportKey(region, experimentId)) : undefined;
    return {
      experimentId,
      waiting,
      cancelled,
      state: report?.state ?? (experimentId && recent ? 'running' : null),
      report: report
        ? { result: testResult(report.state) ?? 'failed', endedAt: report.ended_at?.toISOString() ?? null }
        : null,
    };
  });
  const { result, endedAt } = runOutcome(items);
  return {
    kind: 'run',
    id: run.id,
    label: run.label,
    accountId: run.cloud_account_id,
    accountName: run.account_name,
    environmentName: run.environment_name,
    startedBy: run.started_by_email,
    startedAt: run.started_at.toISOString(),
    endedAt,
    result,
    counts: countsOf(items),
  };
};

const testEntry = (report: ReportRow): TestHistoryEntry => ({
  kind: 'test',
  id: report.id,
  label: report.label,
  accountId: report.cloud_account_id,
  accountName: report.account_name,
  environmentName: report.environment_name,
  startedBy: report.started_by_email,
  startedAt: report.started_at?.toISOString() ?? null,
  endedAt: report.ended_at?.toISOString() ?? null,
  result: testResult(report.state) ?? 'failed',
  counts: null,
});

type EntryFilter = Pick<TestHistoryFilter, 'label' | 'result'>;

const matches = (entry: TestHistoryEntry, { label, result }: EntryFilter): boolean =>
  (!label || entry.label === label) &&
  (!result || entry.result === result);

/** One entry per group run or Run all, and one per test started on its own, newest first. */
export const historyEntries = (
  runs: readonly HistoryRun[],
  reports: readonly ReportRow[],
  filter: EntryFilter,
  now = new Date(),
): TestHistoryEntry[] => {
  const byKey = new Map(reports.map((report) => [reportKey(report.region, report.experiment_id), report]));
  const inRuns = new Set(
    runs.flatMap(({ items }) => items.flatMap(({ region, experimentId }) => (experimentId ? [reportKey(region, experimentId)] : []))),
  );
  const entries = [
    ...runs.map((run) => runEntry(run, byKey, now)),
    ...reports.filter((report) => !inRuns.has(reportKey(report.region, report.experiment_id))).map(testEntry),
  ];
  return entries
    .filter((entry) => matches(entry, filter))
    .sort((first, second) => (second.startedAt ?? '').localeCompare(first.startedAt ?? ''));
};

const CSV_HEADER = [
  'Type',
  'Name',
  'Account',
  'Environment',
  'Result',
  'Started',
  'Ended',
  'Minutes',
  'Started by',
  'Tests',
  'Passed',
  'Stopped',
  'Failed',
  "Didn't start",
  'Cancelled',
];

const csvCell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

const minutesBetween = (from: string | null, to: string | null): number | null =>
  from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 60_000) : null;

export const historyCsv = (entries: readonly TestHistoryEntry[]): string =>
  [
    CSV_HEADER,
    ...entries.map((entry) => [
      entry.kind === 'run' ? 'Run' : 'Test',
      entry.label,
      entry.accountName,
      entry.environmentName,
      entry.result,
      entry.startedAt,
      entry.endedAt,
      minutesBetween(entry.startedAt, entry.endedAt),
      entry.startedBy,
      entry.counts?.total ?? 1,
      entry.counts?.passed ?? null,
      entry.counts?.stopped ?? null,
      entry.counts?.failed ?? null,
      entry.counts?.notStarted ?? null,
      entry.counts?.cancelled ?? null,
    ]),
  ]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
