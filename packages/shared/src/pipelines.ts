export const PIPELINE_STATUSES = [
  'running',
  'queued',
  'success',
  'failure',
  'cancelled',
  'skipped',
  'unknown',
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const isActivePipelineStatus = (status: PipelineStatus): boolean =>
  status === 'running' || status === 'queued';

export interface PipelineRun {
  id: string;
  workflowId: string;
  workflowName: string;
  repository: string;
  number: number;
  title: string;
  branch: string;
  commit: string;
  event: string;
  actor: string | null;
  status: PipelineStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  url: string;
}

export interface PipelineStep {
  number: number;
  name: string;
  status: PipelineStatus;
  durationSeconds: number | null;
}

export interface PipelineJob {
  id: string;
  name: string;
  status: PipelineStatus;
  durationSeconds: number | null;
  url: string;
  steps: PipelineStep[];
}

export type PipelineInputType = 'string' | 'boolean' | 'choice' | 'number' | 'environment';

export interface PipelineInput {
  name: string;
  description: string | null;
  required: boolean;
  type: PipelineInputType;
  defaultValue: string | null;
  options: string[];
}

export interface PipelineEnvironmentRule {
  branch: string;
  matched: string;
  otherwise: string;
}

export interface PipelineDefinition {
  manual: boolean;
  inputs: PipelineInput[];
  environments: string[];
  environmentRule: PipelineEnvironmentRule | null;
  opaqueEnvironment: boolean;
}

export interface PipelineActionAccess {
  canAct: boolean;
  production: boolean;
  reason: string | null;
}

export interface PipelineBranchAccess {
  branch: string;
  matched: PipelineActionAccess;
  otherwise: PipelineActionAccess;
}

export interface PipelineRunOptions {
  definition: PipelineDefinition;
  access: PipelineActionAccess;
  branchAccess: PipelineBranchAccess | null;
  defaultBranch: string;
  branches: string[];
}

export interface PipelineSummary {
  appId: string;
  repository: string;
  workflowId: string;
  name: string;
  path: string;
  url: string;
  latestRun: PipelineRun | null;
  environmentId: string | null;
  environmentName: string | null;
  environmentIds: string[];
  branchRouted: boolean;
  production: boolean;
}

export interface PipelineDeploymentTime {
  environmentName: string;
  averageSeconds: number | null;
  runs: number;
}

export interface PipelineApp {
  id: string;
  name: string;
  repository: string;
  connectionId: string | null;
}

export interface RepositoryChoice {
  connectionId: string;
  connectionName: string;
  repository: string;
}

export interface PipelineAppSummary extends PipelineApp {
  pipelines: number;
  running: number;
  failed: number;
  deployments: PipelineDeploymentTime[];
}

export interface PipelineAppsOverview {
  configured: boolean;
  apps: PipelineAppSummary[];
  issues: string[];
}

export interface PipelineActivityItem {
  appId: string;
  appName: string;
  workflowId: string;
  name: string;
  environmentName: string | null;
  run: PipelineRun;
}

export interface PipelineActivity {
  configured: boolean;
  running: PipelineActivityItem[];
  failed: PipelineActivityItem[];
  issues: string[];
}

export interface PipelineAppDetail {
  app: PipelineApp;
  pipelines: PipelineSummary[];
  deployments: PipelineDeploymentTime[];
  issues: string[];
}

export interface PipelineRunDetail {
  app: PipelineApp;
  rerunsFailedJobs: boolean;
  run: PipelineRun;
  jobs: PipelineJob[];
  access: PipelineActionAccess;
  environmentName: string | null;
}

export interface PipelineHistory {
  app: PipelineApp;
  pipeline: PipelineSummary;
  runs: PipelineRun[];
  options: PipelineRunOptions;
}
