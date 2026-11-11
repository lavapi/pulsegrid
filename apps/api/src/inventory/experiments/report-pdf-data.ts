import type { ExperimentReport, ExperimentRunDetail, ExperimentRunItemState, RunResult, TestResult } from '@pulsegrid/shared';
import type { PdfReport, PdfRow } from './report-pdf';

const RUN_RESULTS: Record<RunResult, string> = {
  passed: 'Passed',
  stopped: 'Stopped',
  failed: 'Failed',
  running: 'Running',
  unknown: 'Unknown',
};
const TEST_RESULTS: Record<TestResult, string> = { passed: 'Completed', stopped: 'Stopped', failed: 'Failed' };

const between = (from: string | null | undefined, to: string | null | undefined): number | null =>
  from && to ? Date.parse(to) - Date.parse(from) : null;

/** The final state and why, in the words the report uses. Completed tests need no reason. */
const outcomeOf = (item: ExperimentRunItemState): Pick<PdfRow, 'result' | 'reason'> => {
  if (item.skipped) {
    return { result: 'Skipped', reason: item.skipped };
  }
  if (item.cancelled) {
    return { result: 'Cancelled', reason: item.note ?? null };
  }
  if (item.error) {
    return { result: "Didn't start", reason: item.error };
  }
  if (item.report) {
    return { result: TEST_RESULTS[item.report.result], reason: item.report.result === 'passed' ? null : item.report.reason };
  }
  if (item.waiting) {
    return { result: 'Waiting', reason: item.note ?? null };
  }
  return { result: item.experimentId ? 'Running' : 'Unknown', reason: null };
};

const toRow = (item: ExperimentRunItemState): PdfRow => {
  const startedAt = item.report?.startedAt ?? item.startedAt ?? null;
  const endedAt = item.report?.endedAt ?? item.endedAt ?? null;
  return {
    label: item.label,
    startedAt,
    endedAt,
    ...outcomeOf(item),
    healthyAfterMs: between(endedAt, item.healthyAt),
    repairs: item.repairs ?? [],
  };
};

const counted = (count: number, word: string): string[] => (count > 0 ? [`${count} ${word}`] : []);

/** A run's PDF: every test in the order it ran, with how long the environment took to be healthy again. */
export const runPdf = (run: ExperimentRunDetail): PdfReport => {
  const rows = run.items.map(toRow);
  const results = rows.map(({ result }) => result);
  const repairs = run.items.flatMap(({ repairs = [] }) => repairs);
  const count = (result: string) => results.filter((item) => item === result).length;
  return {
    title: 'Failover test run',
    name: run.label,
    environment: run.environmentName,
    account: run.accountName,
    startedBy: run.startedBy,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    result: RUN_RESULTS[run.result],
    summary: [
      `${rows.length} tests`,
      `${count('Completed')} completed`,
      ...counted(count('Skipped'), 'skipped'),
      ...counted(count('Stopped'), 'stopped'),
      `${count('Failed') + count("Didn't start")} failed`,
      ...counted(count('Cancelled'), 'cancelled'),
      `${repairs.length} ${repairs.length === 1 ? 'repair' : 'repairs'}`,
    ].join(' · '),
    rows,
    notes: [
      ...(run.stoppedReason ? [run.stoppedReason] : []),
      ...repairs.filter(({ at }) => at === null).map(({ text }) => text),
    ],
  };
};

/** A single test's PDF: the same table with one row. */
export const testPdf = (report: ExperimentReport): PdfReport => ({
  title: 'Failover test',
  name: report.label,
  environment: report.environmentName,
  account: report.accountName,
  startedBy: report.startedBy,
  startedAt: report.startedAt,
  endedAt: report.endedAt,
  result: TEST_RESULTS[report.result],
  summary: `${report.experimentId} · ${report.region}`,
  rows: [
    {
      label: report.label,
      startedAt: report.startedAt,
      endedAt: report.endedAt,
      result: TEST_RESULTS[report.result],
      reason: report.result === 'passed' ? null : report.reason,
      healthyAfterMs: null,
      repairs: [],
    },
  ],
  notes: [],
});

/** A valid IANA timezone, falling back to UTC. */
export const safeTimeZone = (value: string | undefined): string => {
  if (!value) {
    return 'UTC';
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
};

/** A file name like failover-tests-all-tests-2026-11-11.pdf. */
export const pdfName = (name: string, startedAt: string | null): string =>
  `failover-tests-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${(startedAt ?? '').slice(0, 10)}.pdf`;
