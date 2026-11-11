import type { ResourceType } from './inventory';

export const EXPERIMENT_STATES = [
  'pending',
  'initiating',
  'running',
  'stopping',
  'completed',
  'stopped',
  'failed',
  'cancelled',
] as const;

export type ExperimentState = (typeof EXPERIMENT_STATES)[number];

export const ACTIVE_EXPERIMENT_STATES: readonly ExperimentState[] = ['pending', 'initiating', 'running', 'stopping'];

export const isActiveExperiment = (state: ExperimentState): boolean => ACTIVE_EXPERIMENT_STATES.includes(state);

export interface ExperimentTarget {
  name: string;
  resourceType: string;
  /** What the target picks: listed resources, tags or filters, in plain words. */
  selection: string;
  resourceIds: string[];
}

export interface ExperimentStep {
  name: string;
  actionId: string;
  description: string | null;
  duration: string | null;
}

export interface ExperimentTemplate {
  id: string;
  region: string;
  label: string;
  description: string | null;
  targets: ExperimentTarget[];
  steps: ExperimentStep[];
  stopAlarms: string[];
}

export interface ExperimentSummary {
  id: string;
  region: string;
  templateId: string;
  label: string;
  state: ExperimentState;
  reason: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ExperimentStepState extends ExperimentStep {
  state: string;
  reason: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface ExperimentResource {
  id: string;
  name: string;
  type: ResourceType;
  path: string;
}

export interface ExperimentAccess {
  canRun: boolean;
  /** Why starting or stopping isn't allowed, or null when it is. */
  blockedReason: string | null;
}

export interface ExperimentDetail extends ExperimentSummary {
  description: string | null;
  steps: ExperimentStepState[];
  targets: ExperimentTarget[];
  stopAlarms: string[];
  startedBy: string | null;
  resources: ExperimentResource[];
  access: ExperimentAccess;
}

/** The most templates one group or one run can hold. AWS's limit on tests running at once is separate, and runs work within it in waves. */
export const EXPERIMENT_RUN_LIMIT = 25;

/** AWS FIS allows 5 experiments at once per account and region unless the quota was raised. */
export const DEFAULT_EXPERIMENT_QUOTA = 5;
export const EXPERIMENT_GROUP_NAME_LIMIT = 60;
export const RUN_ALL_LABEL = 'All tests';

export interface ExperimentTemplateRef {
  region: string;
  templateId: string;
}

export const templateKey = ({ region, templateId }: ExperimentTemplateRef): string => `${region}/${templateId}`;

export interface ExperimentGroup {
  id: string;
  name: string;
  templates: ExperimentTemplateRef[];
  /** How many tests this group last ran at a time, suggested again next time. */
  waveSize: number | null;
}

export interface ExperimentGroupInput {
  name: string;
  templates: ExperimentTemplateRef[];
}

export interface ExperimentRunItem extends ExperimentTemplateRef {
  label: string;
  experimentId: string | null;
  /** Why this template didn't start, or null when it did. */
  error: string | null;
  /** Not started yet: it starts when a slot in the run's wave frees up. */
  waiting?: boolean;
  /** Stop all cancelled it before it started. */
  cancelled?: boolean;
}

export interface ExperimentCapacity {
  region: string;
  /** How many tests AWS lets the account run at once in this region. */
  quota: number;
  /** False when the quota couldn't be read and AWS's default is assumed. */
  quotaKnown: boolean;
  running: number;
}

export interface StartRunInput {
  groupId?: string;
  waveSize: number;
}

export interface ExperimentRunSummary {
  id: string;
  label: string;
  startedAt: string;
  startedBy: string | null;
  started: number;
  failed: number;
}

export const TEST_RESULTS = ['passed', 'stopped', 'failed'] as const;

export type TestResult = (typeof TEST_RESULTS)[number];

/** A run's result: a test result once every test has ended, or running, or unknown when AWS lost a result. */
export type RunResult = TestResult | 'running' | 'unknown';

export const RUN_RESULTS: readonly RunResult[] = [...TEST_RESULTS, 'running', 'unknown'];

const RESULT_BY_STATE: Partial<Record<ExperimentState, TestResult>> = {
  completed: 'passed',
  stopped: 'stopped',
  failed: 'failed',
  cancelled: 'failed',
};

/** The result of an ended test, or null while it's still active. */
export const testResult = (state: ExperimentState): TestResult | null => RESULT_BY_STATE[state] ?? null;

/** Passed only when every test completed; any failure or test that didn't start fails the run. Cancelled tests count as stopped. */
export const runResult = (results: readonly RunResult[], notStarted: number): RunResult => {
  if (results.includes('running')) {
    return 'running';
  }
  if (notStarted > 0 || results.includes('failed')) {
    return 'failed';
  }
  if (results.includes('unknown')) {
    return 'unknown';
  }
  return results.includes('stopped') ? 'stopped' : 'passed';
};

export interface ExperimentReportDetails {
  description: string | null;
  steps: ExperimentStepState[];
  targets: ExperimentTarget[];
  stopAlarms: string[];
  /** Resources the test picked, by provider ID. */
  resourceIds: string[];
}

export interface RunItemReport {
  id: string;
  result: TestResult;
  reason: string | null;
  startedAt: string | null;
  endedAt: string | null;
  steps: ExperimentStepState[];
}

export interface ExperimentRunItemState extends ExperimentRunItem {
  /** The live state in AWS, or null when it didn't start or AWS no longer has it. */
  state: ExperimentState | null;
  /** The saved report once the test has ended. */
  report: RunItemReport | null;
}

export interface ExperimentRunDetail extends Omit<ExperimentRunSummary, 'started' | 'failed'> {
  accountName: string;
  /** How many tests run at a time, or null for runs from before waves, which started everything at once. */
  waveSize: number | null;
  environmentName: string | null;
  result: RunResult;
  endedAt: string | null;
  items: ExperimentRunItemState[];
  /** Every known resource the run's tests picked. */
  resources: ExperimentResource[];
  access: ExperimentAccess;
  error: string | null;
}

export interface ExperimentReport {
  id: string;
  experimentId: string;
  region: string;
  templateId: string;
  label: string;
  description: string | null;
  accountId: string;
  accountName: string;
  environmentName: string | null;
  production: boolean;
  startedBy: string | null;
  startedAt: string | null;
  endedAt: string | null;
  state: ExperimentState;
  result: TestResult;
  reason: string | null;
  steps: ExperimentStepState[];
  targets: ExperimentTarget[];
  stopAlarms: string[];
  resources: ExperimentResource[];
  /** The group run or Run all this test was part of. */
  run: { id: string; label: string } | null;
}

export interface RunCounts {
  total: number;
  passed: number;
  stopped: number;
  failed: number;
  notStarted: number;
  waiting: number;
  cancelled: number;
}

export interface TestHistoryEntry {
  kind: 'run' | 'test';
  /** The run's ID, or the report's ID for a single test. */
  id: string;
  label: string;
  /** The cloud account the run or test belongs to. */
  accountId: string;
  accountName: string;
  environmentName: string | null;
  startedBy: string | null;
  startedAt: string | null;
  endedAt: string | null;
  result: RunResult;
  counts: RunCounts | null;
}

export interface TestHistoryFilter {
  environment?: string;
  label?: string;
  result?: RunResult;
  from?: string;
  to?: string;
}

export interface TestHistory {
  entries: TestHistoryEntry[];
  environments: string[];
  labels: string[];
}

export interface StartedExperimentRun {
  id: string;
}

export interface ExperimentsView {
  templates: ExperimentTemplate[];
  experiments: ExperimentSummary[];
  groups: ExperimentGroup[];
  runs: ExperimentRunSummary[];
  access: ExperimentAccess;
  error: string | null;
}

export interface StartedExperiment {
  id: string;
  region: string;
}
