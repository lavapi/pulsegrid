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

/** The most templates one group or one run can hold, to stay under AWS's limit on experiments running at once. */
export const EXPERIMENT_RUN_LIMIT = 25;
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
}

export interface ExperimentRunSummary {
  id: string;
  label: string;
  startedAt: string;
  startedBy: string | null;
  started: number;
  failed: number;
}

export interface ExperimentRunItemState extends ExperimentRunItem {
  /** The live state in AWS, or null when it didn't start or AWS no longer has it. */
  state: ExperimentState | null;
}

export interface ExperimentRunDetail extends Omit<ExperimentRunSummary, 'started' | 'failed'> {
  items: ExperimentRunItemState[];
  access: ExperimentAccess;
  error: string | null;
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
