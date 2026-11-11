import {
  DEPLOYMENT_STAGES,
  type DeploymentStageId,
  type TrafficDeployment,
  type TrafficDeploymentStatus,
} from '@pulsegrid/shared';

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

const STATUSES: Record<TrafficDeploymentStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'warning' },
  'in-progress': { label: 'In progress', tone: 'warning' },
  succeeded: { label: 'Completed', tone: 'success' },
  stopping: { label: 'Stopping', tone: 'warning' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  'rolling-back': { label: 'Rolling back', tone: 'danger' },
  'rolled-back': { label: 'Rolled back', tone: 'danger' },
  'rollback-failed': { label: 'Rollback failed', tone: 'danger' },
};

export const deploymentStatusLabel = (status: TrafficDeploymentStatus): string => STATUSES[status].label;

export const deploymentStatusTone = (status: TrafficDeploymentStatus): Tone => STATUSES[status].tone;

export const STRATEGY_LABELS = { 'blue-green': 'Blue/green', canary: 'Canary', linear: 'Linear' } as const;

export type StepState = 'done' | 'current' | 'failed' | 'upcoming';

/** Where each stage stands: done before the current one, current, failed when the deployment ended badly there. */
export const stepStates = ({ stage, status }: Pick<TrafficDeployment, 'stage' | 'status'>): Record<DeploymentStageId, StepState> => {
  const current = DEPLOYMENT_STAGES.findIndex(({ id }) => id === stage);
  const finished = status === 'succeeded';
  const failed = ['stopped', 'rolled-back', 'rollback-failed'].includes(status);
  return Object.fromEntries(
    DEPLOYMENT_STAGES.map(({ id }, index) => {
      if (finished || index < current) {
        return [id, 'done'];
      }
      if (index === current) {
        return [id, failed ? 'failed' : 'current'];
      }
      return [id, 'upcoming'];
    }),
  ) as Record<DeploymentStageId, StepState>;
};
