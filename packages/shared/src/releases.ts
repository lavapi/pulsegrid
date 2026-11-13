import type { EnvironmentDomain } from './environment-domains';
import type { PipelineRun } from './pipelines';

export type ReleaseStageStatus = 'waiting' | 'running' | 'success' | 'failure' | 'cancelled';

export interface ReleaseStage {
  label: string;
  status: ReleaseStageStatus;
  detail: string | null;
  durationSeconds: number | null;
}

export type ReleaseState =
  | 'idle'
  | 'building'
  | 'deploying'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'not_deployed';

export type ReleaseMatch = 'commit' | 'time';

export const isActiveRelease = (state: ReleaseState): boolean =>
  state === 'building' || state === 'deploying';

export interface Release {
  id: string;
  appId: string;
  appName: string;
  workflowId: string;
  pipelineName: string;
  serviceName: string;
  /** The service's display name in PulseGrid, when it has one. */
  serviceDisplayName: string | null;
  servicePath: string | null;
  environmentName: string | null;
  appDomains: EnvironmentDomain[];
  run: PipelineRun | null;
  state: ReleaseState;
  stages: ReleaseStage[];
  readyAt: string | null;
  matchedBy: ReleaseMatch | null;
  issue: string | null;
}

export interface ReleasesOverview {
  configured: boolean;
  releases: Release[];
}

export interface ReleasePipelineChoice {
  appId: string;
  workflowId: string;
  label: string;
}

export interface ReleaseServiceChoice {
  accountId: string;
  nativeId: string;
  label: string;
  description: string;
}

export interface ReleaseChoices {
  pipelines: ReleasePipelineChoice[];
  services: ReleaseServiceChoice[];
}
