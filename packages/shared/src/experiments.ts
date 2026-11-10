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

export interface ExperimentsView {
  templates: ExperimentTemplate[];
  experiments: ExperimentSummary[];
  access: ExperimentAccess;
  error: string | null;
}

export interface StartedExperiment {
  id: string;
  region: string;
}
