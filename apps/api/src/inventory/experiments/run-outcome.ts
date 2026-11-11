import { type ExperimentState, isActiveExperiment, type RunResult, runResult, type TestResult } from '@pulsegrid/shared';

export interface OutcomeItem {
  experimentId: string | null;
  waiting?: boolean;
  cancelled?: boolean;
  state: ExperimentState | null;
  report: { result: TestResult; endedAt: string | null } | null;
}

/** A test that never started because AWS refused it or the template was gone, rather than one still to come or cancelled. */
export const didNotStart = ({ experimentId, waiting, cancelled }: OutcomeItem): boolean =>
  experimentId === null && !waiting && !cancelled;

const itemResult = ({ state, report, waiting, cancelled }: OutcomeItem): RunResult => {
  if (report) {
    return report.result;
  }
  if (waiting) {
    return 'running';
  }
  if (cancelled) {
    return 'stopped';
  }
  return state && isActiveExperiment(state) ? 'running' : 'unknown';
};

/** The run's result, and when it ended once every test has. */
export const runOutcome = (items: readonly OutcomeItem[]): { result: RunResult; endedAt: string | null } => {
  const counted = items.filter((item) => !didNotStart(item));
  const started = items.filter(({ experimentId }) => experimentId !== null);
  const result = runResult(counted.map(itemResult), items.length - counted.length);
  const ends = started.flatMap(({ report }) => (report?.endedAt ? [report.endedAt] : []));
  return { result, endedAt: result === 'running' ? null : (ends.sort().at(-1) ?? null) };
};
