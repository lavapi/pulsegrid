import {
  DescribeServiceDeploymentsCommand,
  DescribeServiceRevisionsCommand,
  type ECSClient,
  ListServiceDeploymentsCommand,
  type ServiceDeployment,
  type ServiceRevision,
  type ServiceRevisionSummary,
} from '@aws-sdk/client-ecs';
import type {
  DeploymentSide,
  DeploymentStageId,
  DeploymentStrategy,
  TrafficDeployment,
  TrafficDeploymentStatus,
} from '@pulsegrid/shared';

const STRATEGIES: Record<string, DeploymentStrategy> = {
  ROLLING: 'rolling',
  BLUE_GREEN: 'blue-green',
  CANARY: 'canary',
  LINEAR: 'linear',
};

const STAGES: Record<string, DeploymentStageId> = {
  RECONCILE_SERVICE: 'scale-up',
  PRE_SCALE_UP: 'scale-up',
  SCALE_UP: 'scale-up',
  POST_SCALE_UP: 'scale-up',
  TEST_TRAFFIC_SHIFT: 'test-traffic',
  POST_TEST_TRAFFIC_SHIFT: 'test-traffic',
  PRODUCTION_TRAFFIC_SHIFT: 'production-traffic',
  POST_PRODUCTION_TRAFFIC_SHIFT: 'production-traffic',
  BAKE_TIME: 'bake-time',
  CLEAN_UP: 'clean-up',
};

const STATUSES: Record<string, TrafficDeploymentStatus> = {
  PENDING: 'pending',
  IN_PROGRESS: 'in-progress',
  SUCCESSFUL: 'succeeded',
  STOP_REQUESTED: 'stopping',
  STOPPED: 'stopped',
  ROLLBACK_REQUESTED: 'rolling-back',
  ROLLBACK_IN_PROGRESS: 'rolling-back',
  ROLLBACK_SUCCESSFUL: 'rolled-back',
  ROLLBACK_FAILED: 'rollback-failed',
};

export const strategyOf = (value: unknown): DeploymentStrategy =>
  (typeof value === 'string' && STRATEGIES[value]) || 'rolling';

const iso = (date: Date | undefined): string | null => date?.toISOString() ?? null;

/** The short name people know a revision by: the last part of its ARN. */
const revisionName = (arn: string): string => arn.split('/').at(-1) ?? arn;

const toSide = (summary: ServiceRevisionSummary, revisions: ReadonlyMap<string, ServiceRevision>): DeploymentSide => {
  const revision = revisions.get(summary.arn ?? '');
  return {
    revision: revisionName(summary.arn ?? ''),
    taskDefinition: revision?.taskDefinition?.split('/').at(-1) ?? null,
    images: (revision?.containerImages ?? []).flatMap(({ image }) => (image ? [image] : [])),
    runningTasks: summary.runningTaskCount ?? 0,
    requestedTasks: summary.requestedTaskCount ?? 0,
    testTrafficPercent: summary.requestedTestTrafficWeight ?? null,
    productionTrafficPercent: summary.requestedProductionTrafficWeight ?? null,
  };
};

const hookStagesOf = (deployment: ServiceDeployment): DeploymentStageId[] => [
  ...new Set(
    (deployment.deploymentConfiguration?.lifecycleHooks ?? []).flatMap(({ lifecycleStages = [] }) =>
      lifecycleStages.flatMap((stage) => (STAGES[stage] ? [STAGES[stage]] : [])),
    ),
  ),
];

export const toTrafficDeployment = (
  deployment: ServiceDeployment,
  revisions: ReadonlyMap<string, ServiceRevision>,
): TrafficDeployment => {
  const strategy = strategyOf(deployment.deploymentConfiguration?.strategy);
  const source = deployment.sourceServiceRevisions?.[0];
  return {
    id: deployment.serviceDeploymentArn?.split('/').at(-1) ?? '',
    strategy: strategy === 'rolling' ? 'blue-green' : strategy,
    status: STATUSES[deployment.status ?? ''] ?? 'pending',
    stage: STAGES[deployment.lifecycleStage ?? ''] ?? null,
    startedAt: iso(deployment.startedAt ?? deployment.createdAt),
    finishedAt: iso(deployment.finishedAt ?? deployment.stoppedAt),
    updatedAt: iso(deployment.updatedAt),
    bakeTimeMinutes: deployment.deploymentConfiguration?.bakeTimeInMinutes ?? null,
    reason: deployment.statusReason ?? null,
    rollbackReason: deployment.rollback?.reason ?? null,
    blue: source ? toSide(source, revisions) : null,
    green: deployment.targetServiceRevision ? toSide(deployment.targetServiceRevision, revisions) : null,
    hookStages: hookStagesOf(deployment),
  };
};

/** A service's recent deployments with their blue and green revisions, newest first. */
export const readTrafficDeployments = async (
  client: ECSClient,
  cluster: string,
  service: string,
  limit: number,
): Promise<TrafficDeployment[]> => {
  const { serviceDeployments = [] } = await client.send(
    new ListServiceDeploymentsCommand({ cluster, service, maxResults: limit }),
  );
  const arns = serviceDeployments.flatMap(({ serviceDeploymentArn }) => serviceDeploymentArn ?? []).slice(0, limit);
  if (arns.length === 0) {
    return [];
  }
  const { serviceDeployments: deployments = [] } = await client.send(
    new DescribeServiceDeploymentsCommand({ serviceDeploymentArns: arns }),
  );
  const revisionArns = [
    ...new Set(
      deployments.flatMap(({ sourceServiceRevisions = [], targetServiceRevision }) =>
        [...sourceServiceRevisions, ...(targetServiceRevision ? [targetServiceRevision] : [])].flatMap(
          ({ arn }) => arn ?? [],
        ),
      ),
    ),
  ];
  const { serviceRevisions = [] } = revisionArns.length
    ? await client.send(new DescribeServiceRevisionsCommand({ serviceRevisionArns: revisionArns }))
    : { serviceRevisions: [] };
  const revisions = new Map(serviceRevisions.map((revision) => [revision.serviceRevisionArn ?? '', revision]));
  return deployments
    .map((deployment) => toTrafficDeployment(deployment, revisions))
    .sort((first, second) => (second.startedAt ?? '').localeCompare(first.startedAt ?? ''));
};
