/**
 * The stages of a deployment that shifts traffic from the live (blue) side to the new (green) side, in order.
 * ECS calls user traffic "production traffic" in every environment; it's shown as live traffic so it isn't
 * mistaken for the production environment.
 */
export const DEPLOYMENT_STAGES = [
  { id: 'scale-up', label: 'Scale up green' },
  { id: 'test-traffic', label: 'Test traffic to green' },
  { id: 'production-traffic', label: 'Live traffic to green' },
  { id: 'bake-time', label: 'Bake time' },
  { id: 'clean-up', label: 'Clean up blue' },
] as const;

export type DeploymentStageId = (typeof DEPLOYMENT_STAGES)[number]['id'];

export type DeploymentStrategy = 'rolling' | 'blue-green' | 'canary' | 'linear';

export type TrafficDeploymentStatus =
  | 'pending'
  | 'in-progress'
  | 'succeeded'
  | 'stopping'
  | 'stopped'
  | 'rolling-back'
  | 'rolled-back'
  | 'rollback-failed';

const ACTIVE: readonly TrafficDeploymentStatus[] = ['pending', 'in-progress', 'stopping', 'rolling-back'];
const UNSUCCESSFUL: readonly TrafficDeploymentStatus[] = ['stopped', 'rolled-back', 'rollback-failed'];

export const isActiveTrafficDeployment = (status: TrafficDeploymentStatus): boolean => ACTIVE.includes(status);

export const isUnsuccessfulTrafficDeployment = (status: TrafficDeploymentStatus): boolean =>
  UNSUCCESSFUL.includes(status);

const stageIndex = (stage: DeploymentStageId | null): number =>
  stage === null ? -1 : DEPLOYMENT_STAGES.findIndex(({ id }) => id === stage);

/** True once the deployment is at or past the given stage. */
export const hasReachedStage = (current: DeploymentStageId | null, target: DeploymentStageId): boolean =>
  stageIndex(current) >= stageIndex(target);

export const stageLabel = (stage: DeploymentStageId): string =>
  DEPLOYMENT_STAGES.find(({ id }) => id === stage)?.label ?? stage;

export interface DeploymentSide {
  revision: string;
  taskDefinition: string | null;
  images: string[];
  runningTasks: number;
  requestedTasks: number;
  /** The share of test traffic this side asked for, 0 to 100, when ECS reports it. */
  testTrafficPercent: number | null;
  /** The share of live (user) traffic, which ECS calls production traffic in every environment. */
  productionTrafficPercent: number | null;
}

export interface TrafficDeployment {
  id: string;
  strategy: Exclude<DeploymentStrategy, 'rolling'>;
  status: TrafficDeploymentStatus;
  stage: DeploymentStageId | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string | null;
  bakeTimeMinutes: number | null;
  reason: string | null;
  rollbackReason: string | null;
  /** Live before the deployment: what traffic moves away from. */
  blue: DeploymentSide | null;
  /** The new revision traffic moves to. */
  green: DeploymentSide | null;
  /** Stages where the service runs its own lifecycle hooks. */
  hookStages: DeploymentStageId[];
}

export interface ServiceDeploymentsView {
  strategy: DeploymentStrategy | null;
  /** Newest first. Empty for rolling services, which show on Releases as before. */
  deployments: TrafficDeployment[];
  error: string | null;
}
