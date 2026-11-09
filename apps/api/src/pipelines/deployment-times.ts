import type { PipelineDeploymentTime, PipelineRun } from '@pulsegrid/shared';
import {
  environmentOfRun,
  type EnvironmentRef,
  type PipelineContext,
  pipelineEnvironments,
} from './pipeline-summaries';
import { isProductionName } from '../inventory/environments/environment-detection';

export interface Deployment {
  environmentName: string;
  durationSeconds: number;
}

export const deploymentsOf = (
  context: PipelineContext,
  runs: readonly PipelineRun[],
): Deployment[] => {
  if (pipelineEnvironments(context).length === 0) {
    return [];
  }
  return runs.flatMap((run) => {
    const environmentName = environmentOfRun(context, run);
    return run.status === 'success' && run.durationSeconds !== null && environmentName
      ? [{ environmentName, durationSeconds: run.durationSeconds }]
      : [];
  });
};

const productionLast = (first: EnvironmentRef, second: EnvironmentRef): number =>
  Number(isProductionName(first.name)) - Number(isProductionName(second.name)) ||
  first.name.localeCompare(second.name);

const average = (values: readonly number[]): number | null =>
  values.length > 0
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
    : null;

export const averageDeployments = (
  deployments: readonly Deployment[],
  environments: readonly EnvironmentRef[],
): PipelineDeploymentTime[] =>
  [...environments].sort(productionLast).map(({ name }) => {
    const durations = deployments
      .filter(({ environmentName }) => environmentName === name)
      .map(({ durationSeconds }) => durationSeconds);
    return {
      environmentName: name,
      averageSeconds: average(durations),
      runs: durations.length,
    };
  });
