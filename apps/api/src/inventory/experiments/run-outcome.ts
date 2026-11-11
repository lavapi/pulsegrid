import { type ExperimentState, isActiveExperiment, type RunResult, runResult, type TestResult } from '@pulsegrid/shared';

export interface OutcomeItem {
  experimentId: string | null;
  state: ExperimentState | null;
  report: { result: TestResult; endedAt: string | null } | null;
}

const itemResult = ({ state, report }: OutcomeItem): RunResult => {
  if (report) {
    return report.result;
  }
  return state && isActiveExperiment(state) ? 'running' : 'unknown';
};

/** The run's result, and when it ended once every test has. */
export const runOutcome = (items: readonly OutcomeItem[]): { result: RunResult; endedAt: string | null } => {
  const started = items.filter(({ experimentId }) => experimentId !== null);
  const result = runResult(started.map(itemResult), items.length - started.length);
  const ends = started.flatMap(({ report }) => (report?.endedAt ? [report.endedAt] : []));
  return { result, endedAt: result === 'running' ? null : (ends.sort().at(-1) ?? null) };
};
