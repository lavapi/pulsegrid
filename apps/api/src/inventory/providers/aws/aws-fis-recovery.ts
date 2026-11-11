import { DescribeInstanceStatusCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DescribeServicesCommand, ECSClient } from '@aws-sdk/client-ecs';
import {
  DescribeCacheClustersCommand,
  DescribeReplicationGroupsCommand,
  ElastiCacheClient,
} from '@aws-sdk/client-elasticache';
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import type { ExperimentContext, InventoryItem } from '../provider';
import type { AwsKey } from './aws-key';

const AVAILABLE = 'available';
const OK = 'ok';

type Check = (context: ExperimentContext<AwsKey>, resource: InventoryItem) => Promise<boolean>;

const CHECKS: Partial<Record<InventoryItem['type'], Check>> = {
  'rds-instance': async ({ region, credentials }, { name }) => {
    const { DBInstances = [] } = await new RDSClient({ region, credentials }).send(
      new DescribeDBInstancesCommand({ DBInstanceIdentifier: name }),
    );
    return DBInstances[0]?.DBInstanceStatus === AVAILABLE;
  },
  'rds-cluster': async ({ region, credentials }, { name }) => {
    const { DBClusters = [] } = await new RDSClient({ region, credentials }).send(
      new DescribeDBClustersCommand({ DBClusterIdentifier: name }),
    );
    return DBClusters[0]?.Status === AVAILABLE;
  },
  'elasticache-replication-group': async ({ region, credentials }, { name }) => {
    const { ReplicationGroups = [] } = await new ElastiCacheClient({ region, credentials }).send(
      new DescribeReplicationGroupsCommand({ ReplicationGroupId: name }),
    );
    return ReplicationGroups[0]?.Status === AVAILABLE;
  },
  'elasticache-cluster': async ({ region, credentials }, { name }) => {
    const { CacheClusters = [] } = await new ElastiCacheClient({ region, credentials }).send(
      new DescribeCacheClustersCommand({ CacheClusterId: name }),
    );
    return CacheClusters[0]?.CacheClusterStatus === AVAILABLE;
  },
  'ecs-service': async ({ region, credentials }, { nativeId, details }) => {
    const { services = [] } = await new ECSClient({ region, credentials }).send(
      new DescribeServicesCommand({ cluster: details['cluster'] as string, services: [nativeId] }),
    );
    const service = services[0];
    return Boolean(service) && service?.runningCount === service?.desiredCount && (service?.deployments?.length ?? 0) <= 1;
  },
  'ec2-instance': async ({ region, credentials }, { nativeId }) => {
    const { InstanceStatuses = [] } = await new EC2Client({ region, credentials }).send(
      new DescribeInstanceStatusCommand({ InstanceIds: [nativeId] }),
    );
    const status = InstanceStatuses[0];
    return status?.InstanceStatus?.Status === OK && status?.SystemStatus?.Status === OK;
  },
};

/**
 * Whether a resource is healthy again after a failover test: available databases and caches, ECS services with every
 * task running and one deployment, servers passing both status checks. Null when AWS can't be asked.
 */
export const fisIsRecovered = async (
  context: ExperimentContext<AwsKey>,
  resource: InventoryItem,
): Promise<boolean | null> => {
  const check = CHECKS[resource.type];
  if (!check) {
    return null;
  }
  try {
    return await check(context, resource);
  } catch {
    return null;
  }
};
