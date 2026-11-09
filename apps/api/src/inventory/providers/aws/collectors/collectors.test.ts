import {
  DescribeClustersCommand,
  DescribeServicesCommand,
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
} from '@aws-sdk/client-ecs';
import {
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
  DescribeVpcsCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import {
  DescribeLoadBalancersCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  GetBucketLocationCommand,
  GetBucketTaggingCommand,
  ListBucketsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DescribeDBClustersCommand, DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import type { CollectorContext } from '../../provider';
import { ec2Collector } from './ec2.collector';
import { ecsCollector, launchTypeOf, serviceHealth } from './ecs.collector';
import { targetsOfBalancer } from './load-balancer-targets';
import { networkCollector } from './network.collector';
import { rdsCollector } from './rds.collector';
import { s3Collector } from './s3.collector';
import type { AwsKey } from '../aws-key';
import { isPublicSubnet } from './subnet-routing';

const context: CollectorContext<AwsKey> = {
  region: 'eu-central-1',
  credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
};

const ecs = mockClient(ECSClient);
const ec2 = mockClient(EC2Client);
const rds = mockClient(RDSClient);
const s3 = mockClient(S3Client);
const elb = mockClient(ElasticLoadBalancingV2Client);

beforeEach(() => {
  [ecs, ec2, rds, s3, elb].forEach((client) => client.reset());
});

describe('ecsCollector', () => {
  it('follows pages and describes clusters and services', async () => {
    ecs
      .on(ListClustersCommand)
      .resolvesOnce({ clusterArns: ['arn:c1'], nextToken: 'more' })
      .resolvesOnce({ clusterArns: ['arn:c2'] });
    ecs.on(DescribeClustersCommand).resolves({
      clusters: [
        { clusterArn: 'arn:c1', clusterName: 'one', status: 'ACTIVE', tags: [{ key: 'env', value: 'prod' }] },
        { clusterArn: 'arn:c2', clusterName: 'two', status: 'FAILED' },
      ],
    });
    ecs.on(ListServicesCommand, { cluster: 'arn:c1' }).resolves({ serviceArns: ['arn:s1'] });
    ecs.on(ListServicesCommand, { cluster: 'arn:c2' }).resolves({ serviceArns: [] });
    ecs.on(DescribeServicesCommand).resolves({
      services: [
        { serviceArn: 'arn:s1', serviceName: 'api', status: 'ACTIVE', desiredCount: 2, runningCount: 1 },
      ],
    });

    const resources = await ecsCollector.collect(context);

    expect(resources.map(({ type, name, health }) => [type, name, health])).toEqual([
      ['ecs-cluster', 'one', 'healthy'],
      ['ecs-cluster', 'two', 'degraded'],
      ['ecs-service', 'api', 'degraded'],
    ]);
    expect(resources[0]?.tags).toEqual({ env: 'prod' });
    expect(resources[2]?.details).toMatchObject({ cluster: 'one', desiredTasks: 2 });
    expect(resources[2]?.status).toBe('1/2 tasks');
  });

  it.each([
    ['a direct launch type', { launchType: 'EC2' as const }, {}, 'EC2'],
    [
      'the service capacity providers',
      { capacityProviderStrategy: [{ capacityProvider: 'FARGATE' }, { capacityProvider: 'FARGATE_SPOT' }] },
      { defaultCapacityProviderStrategy: [{ capacityProvider: 'OTHER' }] },
      'FARGATE, FARGATE_SPOT',
    ],
    [
      'the cluster default',
      { capacityProviderStrategy: [] },
      { defaultCapacityProviderStrategy: [{ capacityProvider: 'FARGATE' }] },
      'FARGATE',
    ],
    ['nothing', {}, {}, undefined],
  ])('finds the launch type from %s', (_name, service, cluster, expected) => {
    expect(launchTypeOf(service, cluster)).toBe(expected);
  });

  it.each([
    [{ status: 'ACTIVE', desiredCount: 2, runningCount: 2 }, 'healthy'],
    [{ status: 'ACTIVE', desiredCount: 2, runningCount: 1 }, 'degraded'],
    [{ status: 'ACTIVE', desiredCount: 0, runningCount: 0 }, 'stopped'],
    [{ status: 'DRAINING', desiredCount: 2, runningCount: 2 }, 'degraded'],
  ])('rates %j as %s', (service, expected) => {
    expect(serviceHealth(service)).toBe(expected);
  });
});

describe('rdsCollector', () => {
  it('maps status to health', async () => {
    rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [] });
    rds.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [
        { DBInstanceArn: 'arn:db1', DBInstanceIdentifier: 'up', DBInstanceStatus: 'available', Engine: 'postgres' },
        { DBInstanceArn: 'arn:db2', DBInstanceIdentifier: 'off', DBInstanceStatus: 'stopped' },
        { DBInstanceArn: 'arn:db3', DBInstanceIdentifier: 'full', DBInstanceStatus: 'storage-full' },
        { DBInstanceArn: 'arn:db4', DBInstanceIdentifier: 'busy', DBInstanceStatus: 'backing-up' },
      ],
    });

    const resources = await rdsCollector.collect(context);

    expect(resources.map(({ health }) => health)).toEqual(['healthy', 'stopped', 'degraded', 'unknown']);
  });
});

describe('s3Collector', () => {
  it('reads bucket tags, and treats an unreadable bucket as untagged', async () => {
    s3.on(ListBucketsCommand).resolves({ Buckets: [{ Name: 'tagged' }, { Name: 'plain' }] });
    s3.on(GetBucketLocationCommand).resolves({ LocationConstraint: 'eu-central-1' });
    s3.on(GetBucketTaggingCommand, { Bucket: 'tagged' }).resolves({ TagSet: [{ Key: 'Project', Value: 'shop' }] });
    s3.on(GetBucketTaggingCommand, { Bucket: 'plain' }).rejects(new Error('NoSuchTagSet'));

    const resources = await s3Collector.collect(context);

    expect(resources.map(({ tags }) => tags)).toEqual([{ Project: 'shop' }, {}]);
  });

  it('finds each bucket region and treats an empty location as us-east-1', async () => {
    s3.on(ListBucketsCommand).resolves({ Buckets: [{ Name: 'eu' }, { Name: 'old' }, { Name: 'locked' }] });
    s3.on(GetBucketLocationCommand, { Bucket: 'eu' }).resolves({ LocationConstraint: 'eu-central-1' });
    s3.on(GetBucketLocationCommand, { Bucket: 'old' }).resolves({});
    s3.on(GetBucketLocationCommand, { Bucket: 'locked' }).rejects(new Error('denied'));

    const resources = await s3Collector.collect(context);

    expect(resources.map(({ name, region }) => [name, region])).toEqual([
      ['eu', 'eu-central-1'],
      ['old', 'us-east-1'],
      ['locked', 'global'],
    ]);
  });
});

describe('ec2Collector', () => {
  it('uses the Name tag and skips terminated instances', async () => {
    ec2.on(DescribeInstancesCommand).resolves({
      Reservations: [
        {
          Instances: [
            { InstanceId: 'i-1', State: { Name: 'running' }, Tags: [{ Key: 'Name', Value: 'bastion' }] },
            { InstanceId: 'i-2', State: { Name: 'stopped' } },
            { InstanceId: 'i-3', State: { Name: 'terminated' } },
          ],
        },
      ],
    });

    const resources = await ec2Collector.collect(context);

    expect(resources.map(({ name, health }) => [name, health])).toEqual([
      ['bastion', 'healthy'],
      ['i-2', 'stopped'],
    ]);
  });
});

describe('isPublicSubnet', () => {
  const internet = { DestinationCidrBlock: '0.0.0.0/0', GatewayId: 'igw-1' };
  const nat = { DestinationCidrBlock: '0.0.0.0/0', NatGatewayId: 'nat-1' };

  it('follows the route table linked to the subnet', () => {
    const tables = [{ Routes: [internet], Associations: [{ SubnetId: 'a' }] }];
    expect(isPublicSubnet({ SubnetId: 'a' }, tables)).toBe(true);
  });

  it('treats NAT-only routes as private', () => {
    const tables = [{ Routes: [nat], Associations: [{ SubnetId: 'a' }] }];
    expect(isPublicSubnet({ SubnetId: 'a' }, tables)).toBe(false);
  });

  it('falls back to the main route table of the VPC', () => {
    const tables = [{ VpcId: 'v', Routes: [internet], Associations: [{ Main: true }] }];
    expect(isPublicSubnet({ SubnetId: 'a', VpcId: 'v' }, tables)).toBe(true);
  });

  it('leaves it unknown when route tables could not be read', () => {
    expect(isPublicSubnet({ SubnetId: 'a' }, [])).toBeUndefined();
  });
});

describe('targetsOfBalancer', () => {
  it('collects the target groups and instances of a load balancer', () => {
    const links = [
      { arn: 'one', balancerArns: ['lb'], instanceIds: ['i-1'] },
      { arn: 'two', balancerArns: ['lb'], instanceIds: ['i-1', 'i-2'] },
      { arn: 'three', balancerArns: ['other'], instanceIds: ['i-3'] },
    ];
    expect(targetsOfBalancer('lb', links)).toEqual({
      targetGroups: ['one', 'two'],
      targetInstances: ['i-1', 'i-2'],
    });
  });
});

describe('networkCollector', () => {
  it('collects network resources and flags internet-facing security groups', async () => {
    ec2.on(DescribeVpcsCommand).resolves({ Vpcs: [{ VpcId: 'vpc-1', State: 'available', CidrBlock: '10.0.0.0/16' }] });
    ec2.on(DescribeSubnetsCommand).resolves({ Subnets: [{ SubnetId: 'subnet-1', State: 'available' }] });
    ec2.on(DescribeSecurityGroupsCommand).resolves({
      SecurityGroups: [
        { GroupId: 'sg-1', GroupName: 'open', IpPermissions: [{ IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] },
        { GroupId: 'sg-2', GroupName: 'closed', IpPermissions: [{ IpRanges: [{ CidrIp: '10.0.0.0/8' }] }] },
      ],
    });
    elb.on(DescribeLoadBalancersCommand).resolves({
      LoadBalancers: [{ LoadBalancerArn: 'arn:lb', LoadBalancerName: 'main', State: { Code: 'active_impaired' } }],
    });

    const resources = await networkCollector.collect(context);

    expect(resources.map(({ type }) => type)).toEqual(['vpc', 'subnet', 'security-group', 'security-group', 'load-balancer']);
    expect(resources[2]?.details['openToInternet']).toBe(true);
    expect(resources[3]?.details['openToInternet']).toBe(false);
    expect(resources[4]?.health).toBe('degraded');
  });
});
