import {
  isActivePipelineStatus,
  type PipelineApp,
  type PipelineAppSummary,
  type PipelineDeploymentTime,
  type PipelineSummary,
} from '@pulsegrid/shared';
import type { PipelineAppRow } from '../database/schema';

export const toPipelineApp = ({
  id,
  name,
  repository,
  connection_id: connectionId,
}: PipelineAppRow): PipelineApp => ({ id, name, repository, connectionId });

export const toAppSummary = (
  app: PipelineApp,
  summaries: readonly PipelineSummary[],
  deployments: PipelineDeploymentTime[],
): PipelineAppSummary => {
  const pipelines = summaries.filter(({ repository }) => repository === app.repository);
  const runs = pipelines.flatMap(({ latestRun }) => latestRun ?? []);
  return {
    ...app,
    pipelines: pipelines.length,
    running: runs.filter(({ status }) => isActivePipelineStatus(status)).length,
    failed: runs.filter(({ status }) => status === 'failure').length,
    deployments,
  };
};
