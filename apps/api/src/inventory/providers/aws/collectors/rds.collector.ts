import {
  type DBCluster,
  type DBInstance,
  paginateDescribeDBClusters,
  paginateDescribeDBInstances,
  RDSClient,
} from '@aws-sdk/client-rds';
import type { CollectedResource, ResourceCollector } from '../../provider';
import type { AwsKey } from '../aws-key';
import { collectPages, healthFrom, type HealthRules, tagMap } from './helpers';

const RDS_HEALTH: HealthRules = {
  healthy: ['available'],
  stopped: ['stopped', 'stopping'],
  degraded: ['failed', 'storage-full', 'incompatible-parameters', 'inaccessible-encryption-credentials'],
};

const securityGroupsOf = (groups: DBInstance['VpcSecurityGroups']): string[] =>
  (groups ?? []).flatMap(({ VpcSecurityGroupId }) => VpcSecurityGroupId ?? []);

const toInstanceResource = (instance: DBInstance, region: string): CollectedResource => {
  const status = instance.DBInstanceStatus ?? 'unknown';
  return {
    type: 'rds-instance',
    region,
    nativeId: instance.DBInstanceArn ?? '',
    name: instance.DBInstanceIdentifier ?? '',
    status,
    health: healthFrom(status, RDS_HEALTH),
    tags: tagMap(instance.TagList),
    details: {
      engine: instance.Engine,
      engineVersion: instance.EngineVersion,
      instanceClass: instance.DBInstanceClass,
      storageGb: instance.AllocatedStorage,
      multiAz: instance.MultiAZ,
      cluster: instance.DBClusterIdentifier,
      publiclyAccessible: instance.PubliclyAccessible,
      storageEncrypted: instance.StorageEncrypted,
      vpcId: instance.DBSubnetGroup?.VpcId,
      subnetIds: instance.DBSubnetGroup?.Subnets?.flatMap(
        ({ SubnetIdentifier }) => SubnetIdentifier ?? [],
      ),
      securityGroups: securityGroupsOf(instance.VpcSecurityGroups),
    },
  };
};

const toClusterResource = (cluster: DBCluster, region: string): CollectedResource => {
  const status = cluster.Status ?? 'unknown';
  return {
    type: 'rds-cluster',
    region,
    nativeId: cluster.DBClusterArn ?? '',
    name: cluster.DBClusterIdentifier ?? '',
    status,
    health: healthFrom(status, RDS_HEALTH),
    tags: tagMap(cluster.TagList),
    details: {
      engine: cluster.Engine,
      engineVersion: cluster.EngineVersion,
      members: cluster.DBClusterMembers?.length,
      multiAz: cluster.MultiAZ,
      storageEncrypted: cluster.StorageEncrypted,
      securityGroups: securityGroupsOf(cluster.VpcSecurityGroups),
    },
  };
};

export const rdsCollector: ResourceCollector<AwsKey> = {
  name: 'rds',
  label: 'RDS',
  scope: 'regional',
  types: ['rds-instance', 'rds-cluster'],
  collect: async ({ credentials, region }) => {
    const client = new RDSClient({ region, credentials });
    const [instances, clusters] = await Promise.all([
      collectPages(paginateDescribeDBInstances({ client }, {}), (page) => page.DBInstances),
      collectPages(paginateDescribeDBClusters({ client }, {}), (page) => page.DBClusters),
    ]);
    return [
      ...clusters.map((item) => toClusterResource(item, region)),
      ...instances.map((item) => toInstanceResource(item, region)),
    ];
  },
};
