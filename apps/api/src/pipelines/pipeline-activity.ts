import {
  isActivePipelineStatus,
  type PipelineActivityItem,
  type PipelineApp,
  type PipelineRun,
  type PipelineSummary,
} from '@pulsegrid/shared';

const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

const newestFirst = (first: PipelineActivityItem, second: PipelineActivityItem): number =>
  (second.run.startedAt ?? '').localeCompare(first.run.startedAt ?? '');

const toItem = (
  pipeline: PipelineSummary,
  run: PipelineRun,
  apps: readonly PipelineApp[],
): PipelineActivityItem => ({
  appId: pipeline.appId,
  appName: apps.find(({ id }) => id === pipeline.appId)?.name ?? pipeline.repository,
  workflowId: pipeline.workflowId,
  name: pipeline.name,
  environmentName: pipeline.environmentName,
  run,
});

const failedRecently = ({ status, finishedAt, startedAt }: PipelineRun, now: Date): boolean => {
  const at = finishedAt ?? startedAt;
  return status === 'failure' && at !== null && now.getTime() - new Date(at).getTime() < FAILURE_WINDOW_MS;
};

export const activityOf = (
  pipelines: readonly PipelineSummary[],
  apps: readonly PipelineApp[],
  now: Date,
): { running: PipelineActivityItem[]; failed: PipelineActivityItem[] } => {
  const items = pipelines.flatMap((pipeline) =>
    pipeline.latestRun ? [toItem(pipeline, pipeline.latestRun, apps)] : [],
  );
  return {
    running: items.filter(({ run }) => isActivePipelineStatus(run.status)).sort(newestFirst),
    failed: items.filter(({ run }) => failedRecently(run, now)).sort(newestFirst),
  };
};
