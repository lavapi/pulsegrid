import { CloudWatchClient, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { DescribeInstancesCommand, EC2Client, StartInstancesCommand } from '@aws-sdk/client-ec2';
import { DescribeServicesCommand, ECSClient } from '@aws-sdk/client-ecs';
import {
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
} from '@aws-sdk/client-elasticache';
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import type { ExperimentContext, InventoryItem, RestartOutcome } from '../provider';
import { isAccessDenied } from './aws-error-messages';
import type { AwsKey } from './aws-key';

const AVAILABLE = 'available';
const HEALTHY = 'healthy';
const OK = 'OK';
const SERVICES_PER_CALL = 10;
const INSTANCE_ID = /instance\/(i-[0-9a-f]+)$/;

type Context = ExperimentContext<AwsKey>;
type Section = (context: Context, inventory: readonly InventoryItem[], alarms: readonly string[]) => Promise<string[]>;

const ofType = (inventory: readonly InventoryItem[], type: InventoryItem['type']) =>
  inventory.filter((item) => item.type === type);

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** Every ECS service has all its tasks running and exactly one deployment. */
const ecsServices: Section = async ({ region, credentials }, inventory) => {
  const client = new ECSClient({ region, credentials });
  const byCluster = new Map<string, InventoryItem[]>();
  for (const service of ofType(inventory, 'ecs-service')) {
    const cluster = String(service.details['cluster'] ?? '');
    byCluster.set(cluster, [...(byCluster.get(cluster) ?? []), service]);
  }
  const problems: string[] = [];
  for (const [cluster, services] of byCluster) {
    for (const batch of chunks(services, SERVICES_PER_CALL)) {
      const { services: described = [] } = await client.send(
        new DescribeServicesCommand({ cluster, services: batch.map(({ nativeId }) => nativeId) }),
      );
      for (const service of described) {
        const running = service.runningCount ?? 0;
        const desired = service.desiredCount ?? 0;
        const deployments = service.deployments?.length ?? 0;
        if (running !== desired || deployments !== 1) {
          problems.push(
            `${service.serviceName}: ${running} of ${desired} tasks running${deployments > 1 ? `, ${deployments} deployments` : ''}`,
          );
        }
      }
    }
  }
  return problems;
};

/** Every target in every target group of the environment's load balancers is healthy. */
const loadBalancerTargets: Section = async ({ region, credentials }, inventory) => {
  const client = new ElasticLoadBalancingV2Client({ region, credentials });
  const problems: string[] = [];
  for (const balancer of ofType(inventory, 'load-balancer')) {
    const { TargetGroups = [] } = await client.send(new DescribeTargetGroupsCommand({ LoadBalancerArn: balancer.nativeId }));
    for (const group of TargetGroups) {
      const { TargetHealthDescriptions = [] } = await client.send(
        new DescribeTargetHealthCommand({ TargetGroupArn: group.TargetGroupArn }),
      );
      const healthy = TargetHealthDescriptions.filter(({ TargetHealth }) => TargetHealth?.State === HEALTHY).length;
      if (healthy < TargetHealthDescriptions.length) {
        problems.push(`${group.TargetGroupName}: ${healthy} of ${TargetHealthDescriptions.length} targets healthy`);
      }
    }
  }
  return problems;
};

const notAvailable = (kind: string, name: string | undefined, status: string | undefined): string[] =>
  status === AVAILABLE ? [] : [`${kind} ${name ?? 'unknown'} is ${status ?? 'unknown'}`];

/** Every Aurora cluster and every database instance is available. */
const databases: Section = async ({ region, credentials }, inventory) => {
  const client = new RDSClient({ region, credentials });
  const clusters = ofType(inventory, 'rds-cluster');
  const instances = ofType(inventory, 'rds-instance');
  const problems: string[] = [];
  for (const { name } of clusters) {
    const { DBClusters = [] } = await client.send(new DescribeDBClustersCommand({ DBClusterIdentifier: name }));
    problems.push(...notAvailable('Database cluster', name, DBClusters[0]?.Status));
  }
  for (const { name } of instances) {
    const { DBInstances = [] } = await client.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: name }));
    problems.push(...notAvailable('Database', name, DBInstances[0]?.DBInstanceStatus));
  }
  return problems;
};

/** Every Valkey or Redis replication group and every one of its nodes is available. */
const caches: Section = async ({ region, credentials }, inventory) => {
  const client = new ElastiCacheClient({ region, credentials });
  const problems: string[] = [];
  for (const { name } of ofType(inventory, 'elasticache-replication-group')) {
    const { ReplicationGroups = [] } = await client.send(new DescribeReplicationGroupsCommand({ ReplicationGroupId: name }));
    const group = ReplicationGroups[0];
    problems.push(...notAvailable('Cache', name, group?.Status));
    for (const member of group?.MemberClusters ?? []) {
      const { CacheClusters = [] } = await client.send(new DescribeCacheClustersCommand({ CacheClusterId: member }));
      problems.push(...notAvailable('Cache node', member, CacheClusters[0]?.CacheClusterStatus));
    }
  }
  return problems;
};

/** The tests' stop alarms are OK. */
const stopAlarms: Section = async ({ region, credentials }, _inventory, alarms) => {
  if (alarms.length === 0) {
    return [];
  }
  const { MetricAlarms = [] } = await new CloudWatchClient({ region, credentials }).send(
    new DescribeAlarmsCommand({ AlarmNames: [...alarms] }),
  );
  return MetricAlarms.filter(({ StateValue }) => StateValue !== OK).map(
    ({ AlarmName, StateValue }) => `Stop alarm ${AlarmName} is ${StateValue ?? 'unknown'}`,
  );
};

const SECTIONS: { label: string; permission: string; check: Section }[] = [
  { label: 'ECS services', permission: 'ecs:DescribeServices', check: ecsServices },
  { label: 'load balancer targets', permission: 'elasticloadbalancing:DescribeTargetHealth', check: loadBalancerTargets },
  { label: 'databases', permission: 'rds:DescribeDBClusters', check: databases },
  { label: 'caches', permission: 'elasticache:DescribeReplicationGroups', check: caches },
  { label: 'stop alarms', permission: 'cloudwatch:DescribeAlarms', check: stopAlarms },
];

/**
 * What's unhealthy in the environment. A part PulseGrid can't read counts as unhealthy, so a test never starts on
 * an environment it couldn't check.
 */
export const fisEnvironmentHealth = async (
  context: Context,
  inventory: readonly InventoryItem[],
  alarms: readonly string[],
): Promise<string[]> => {
  const results = await Promise.all(
    SECTIONS.map(async ({ label, permission, check }) => {
      try {
        return await check(context, inventory, alarms);
      } catch (error) {
        return [
          isAccessDenied(error)
            ? `Can't check ${label}: add ${permission} to the key's IAM policy`
            : `Can't check ${label} right now`,
        ];
      }
    }),
  );
  return results.flat();
};

/** Starts servers a test left stopped. Servers still stopping, or whose start failed, wait for the next try. */
export const fisRestartStopped = async (
  { region, credentials }: Context,
  resourceIds: readonly string[],
): Promise<RestartOutcome> => {
  const ids = resourceIds.flatMap((id) => INSTANCE_ID.exec(id)?.[1] ?? (id.startsWith('i-') ? [id] : []));
  if (ids.length === 0) {
    return { started: [], waiting: [] };
  }
  const client = new EC2Client({ region, credentials });
  const { Reservations = [] } = await client.send(new DescribeInstancesCommand({ InstanceIds: ids }));
  const instances = Reservations.flatMap(({ Instances = [] }) => Instances);
  const stopped = instances.filter(({ State }) => State?.Name === 'stopped').flatMap(({ InstanceId }) => InstanceId ?? []);
  const stopping = instances.filter(({ State }) => State?.Name === 'stopping').flatMap(({ InstanceId }) => InstanceId ?? []);
  if (stopped.length === 0) {
    return { started: [], waiting: stopping };
  }
  try {
    await client.send(new StartInstancesCommand({ InstanceIds: stopped }));
    return { started: stopped, waiting: stopping };
  } catch {
    return { started: [], waiting: [...stopped, ...stopping] };
  }
};
