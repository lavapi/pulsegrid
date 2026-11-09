import {
  type CacheCluster,
  type CacheSubnetGroup,
  ElastiCacheClient,
  ListTagsForResourceCommand,
  paginateDescribeCacheClusters,
  paginateDescribeCacheSubnetGroups,
  paginateDescribeReplicationGroups,
  type ReplicationGroup,
} from '@aws-sdk/client-elasticache';
import type { CollectedResource, ResourceCollector } from '../../provider';
import type { AwsKey } from '../aws-key';
import { collectPages, healthFrom, type HealthRules, optional, safeTags, tagMap } from './helpers';

const CACHE_HEALTH: HealthRules = {
  healthy: ['available'],
  degraded: ['create-failed', 'incompatible-network', 'restore-failed', 'snapshot-failed'],
};

const tagsOf = (client: ElastiCacheClient, arn: string | undefined): Promise<Record<string, string>> =>
  safeTags(async () => {
    const { TagList } = await client.send(new ListTagsForResourceCommand({ ResourceName: arn }));
    return tagMap(TagList);
  });

const toGroupResource = (
  group: ReplicationGroup,
  region: string,
  tags: Record<string, string>,
): CollectedResource => {
  const status = group.Status ?? 'unknown';
  return {
    type: 'elasticache-replication-group',
    region,
    nativeId: group.ARN ?? group.ReplicationGroupId ?? '',
    name: group.ReplicationGroupId ?? '',
    status,
    health: healthFrom(status, CACHE_HEALTH),
    tags,
    details: {
      description: group.Description,
      nodeType: group.CacheNodeType,
      members: group.MemberClusters?.length,
      automaticFailover: group.AutomaticFailover,
      multiAz: group.MultiAZ,
      encryptedInTransit: group.TransitEncryptionEnabled,
      encryptedAtRest: group.AtRestEncryptionEnabled,
    },
  };
};

const networkOf = (cluster: CacheCluster, subnetGroups: readonly CacheSubnetGroup[]) => {
  const subnetGroup = subnetGroups.find(
    ({ CacheSubnetGroupName }) => CacheSubnetGroupName === cluster.CacheSubnetGroupName,
  );
  return {
    vpcId: subnetGroup?.VpcId,
    subnetIds: subnetGroup?.Subnets?.flatMap(({ SubnetIdentifier }) => SubnetIdentifier ?? []),
    securityGroups: cluster.SecurityGroups?.flatMap(({ SecurityGroupId }) => SecurityGroupId ?? []),
  };
};

const toClusterResource = (
  cluster: CacheCluster,
  subnetGroups: readonly CacheSubnetGroup[],
  region: string,
  tags: Record<string, string>,
): CollectedResource => {
  const status = cluster.CacheClusterStatus ?? 'unknown';
  return {
    type: 'elasticache-cluster',
    region,
    nativeId: cluster.ARN ?? cluster.CacheClusterId ?? '',
    name: cluster.CacheClusterId ?? '',
    status,
    health: healthFrom(status, CACHE_HEALTH),
    tags,
    details: {
      engine: cluster.Engine,
      engineVersion: cluster.EngineVersion,
      nodeType: cluster.CacheNodeType,
      nodes: cluster.NumCacheNodes,
      replicationGroup: cluster.ReplicationGroupId,
      ...networkOf(cluster, subnetGroups),
    },
  };
};

export const elastiCacheCollector: ResourceCollector<AwsKey> = {
  name: 'elasticache',
  label: 'ElastiCache',
  scope: 'regional',
  types: ['elasticache-replication-group', 'elasticache-cluster'],
  collect: async ({ credentials, region }) => {
    const client = new ElastiCacheClient({ region, credentials });
    const [groups, clusters, subnetGroups] = await Promise.all([
      collectPages(paginateDescribeReplicationGroups({ client }, {}), (p) => p.ReplicationGroups),
      collectPages(paginateDescribeCacheClusters({ client }, {}), (p) => p.CacheClusters),
      optional(
        collectPages(paginateDescribeCacheSubnetGroups({ client }, {}), (p) => p.CacheSubnetGroups),
      ),
    ]);
    return Promise.all([
      ...groups.map(async (item) => toGroupResource(item, region, await tagsOf(client, item.ARN))),
      ...clusters.map(async (item) =>
        toClusterResource(item, subnetGroups, region, await tagsOf(client, item.ARN)),
      ),
    ]);
  },
};
