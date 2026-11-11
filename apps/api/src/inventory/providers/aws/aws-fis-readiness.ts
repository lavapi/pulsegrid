import { DescribeInstanceStatusCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DescribeServicesCommand, ECSClient } from '@aws-sdk/client-ecs';
import {
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
} from '@aws-sdk/client-elasticache';
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import type { ExperimentContext, InventoryItem, TestFootprint } from '../provider';
import type { AwsKey } from './aws-key';

const AVAILABLE = 'available';
const OK = 'ok';
const SPARE_TASKS = 2;

type Check = (
  context: ExperimentContext<AwsKey>,
  resource: InventoryItem,
  footprint: TestFootprint,
) => Promise<string | null>;

const available = (name: string, status: string | undefined): string | null =>
  status === AVAILABLE ? null : `${name} isn't available (${status ?? 'unknown'})`;

const tasks = (count: number): string => `${count} running task${count === 1 ? '' : 's'}`;

const CHECKS: Partial<Record<InventoryItem['type'], Check>> = {
  'rds-instance': async ({ region, credentials }, { name }) => {
    const { DBInstances = [] } = await new RDSClient({ region, credentials }).send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: name }),
    );
    return available(name, DBInstances[0]?.DBInstanceStatus);
  },
  'rds-cluster': async ({ region, credentials }, { name }) => {
    const { DBClusters = [] } = await new RDSClient({ region, credentials }).send(
      new DescribeDBClustersCommand({ DBClusterIdentifier: name }),
    );
    return available(name, DBClusters[0]?.Status);
  },
  'elasticache-replication-group': async ({ region, credentials }, { name }) => {
    const { ReplicationGroups = [] } = await new ElastiCacheClient({ region, credentials }).send(
      new DescribeReplicationGroupsCommand({ ReplicationGroupId: name }),
    );
    return available(name, ReplicationGroups[0]?.Status);
  },
  'elasticache-cluster': async ({ region, credentials }, { name }) => {
    const { CacheClusters = [] } = await new ElastiCacheClient({ region, credentials }).send(
      new DescribeCacheClustersCommand({ CacheClusterId: name }),
    );
    return available(name, CacheClusters[0]?.CacheClusterStatus);
  },
  'ecs-service': async ({ region, credentials }, { name, nativeId, details }, { needsSpareTask }) => {
    const { services = [] } = await new ECSClient({ region, credentials }).send(
      new DescribeServicesCommand({ cluster: details['cluster'] as string, services: [nativeId] }),
    );
    const running = services[0]?.runningCount ?? 0;
    const desired = services[0]?.desiredCount ?? 0;
    if (running < desired || (services[0]?.deployments?.length ?? 0) > 1) {
      return `${name} has ${running} of ${desired} tasks running or is still deploying`;
    }
    return needsSpareTask && running < SPARE_TASKS ? `${name} has ${tasks(running)}, needs ${SPARE_TASKS}` : null;
  },
  'ec2-instance': async ({ region, credentials }, { name, nativeId }) => {
    const { InstanceStatuses = [] } = await new EC2Client({ region, credentials }).send(
      new DescribeInstanceStatusCommand({ InstanceIds: [nativeId] }),
    );
    const status = InstanceStatuses[0];
    return status?.InstanceStatus?.Status === OK && status?.SystemStatus?.Status === OK
      ? null
      : `${name} isn't running with both status checks passing`;
  },
};

/** Why a test's target isn't ready to be tested, or null when it is or when AWS can't be asked. */
export const fisNotReady = async (
  context: ExperimentContext<AwsKey>,
  resource: InventoryItem,
  footprint: TestFootprint,
): Promise<string | null> => {
  const check = CHECKS[resource.type];
  if (!check) {
    return null;
  }
  try {
    return await check(context, resource, footprint);
  } catch {
    return null;
  }
};
