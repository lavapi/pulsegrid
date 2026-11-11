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
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import type { InventoryItem } from '../provider';
import { fisEnvironmentHealth, fisRestartStopped } from './aws-fis-health';

const REGION = 'eu-central-1';
const context = { credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, region: REGION };
const item = (type: InventoryItem['type'], name: string, details: Record<string, unknown> = {}): InventoryItem => ({
  id: name,
  type,
  nativeId: `arn:${name}`,
  name,
  region: REGION,
  tags: {},
  details,
});
const inventory = [
  item('ecs-service', 'game-api', { cluster: 'main' }),
  item('load-balancer', 'game-lb'),
  item('rds-cluster', 'game-db'),
  item('rds-instance', 'game-db-1'),
  item('elasticache-replication-group', 'game-cache'),
];

const ecs = mockClient(ECSClient);
const elb = mockClient(ElasticLoadBalancingV2Client);
const rds = mockClient(RDSClient);
const cache = mockClient(ElastiCacheClient);
const cloudwatch = mockClient(CloudWatchClient);
const ec2 = mockClient(EC2Client);

const healthy = () => {
  ecs.on(DescribeServicesCommand).resolves({ services: [{ serviceName: 'game-api', runningCount: 2, desiredCount: 2, deployments: [{}] }] });
  elb.on(DescribeTargetGroupsCommand).resolves({ TargetGroups: [{ TargetGroupArn: 'tg', TargetGroupName: 'game-proxy' }] });
  elb.on(DescribeTargetHealthCommand).resolves({
    TargetHealthDescriptions: [{ TargetHealth: { State: 'healthy' } }, { TargetHealth: { State: 'healthy' } }],
  });
  rds.on(DescribeDBClustersCommand).resolves({ DBClusters: [{ Status: 'available' }] });
  rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [{ DBInstanceStatus: 'available' }] });
  cache.on(DescribeReplicationGroupsCommand).resolves({ ReplicationGroups: [{ Status: 'available', MemberClusters: ['game-cache-001'] }] });
  cache.on(DescribeCacheClustersCommand).resolves({ CacheClusters: [{ CacheClusterStatus: 'available' }] });
  cloudwatch.on(DescribeAlarmsCommand).resolves({ MetricAlarms: [{ AlarmName: 'game-errors', StateValue: 'OK' }] });
};

describe('fisEnvironmentHealth', () => {
  beforeEach(() => {
    [ecs, elb, rds, cache, cloudwatch, ec2].forEach((client) => client.reset());
    healthy();
  });

  it('finds nothing wrong in a healthy environment', async () => {
    expect(await fisEnvironmentHealth(context, inventory, ['game-errors'])).toEqual([]);
  });

  it('lists every part that is not healthy', async () => {
    ecs.on(DescribeServicesCommand).resolves({
      services: [{ serviceName: 'game-api', runningCount: 1, desiredCount: 2, deployments: [{}, {}] }],
    });
    elb.on(DescribeTargetHealthCommand).resolves({
      TargetHealthDescriptions: [{ TargetHealth: { State: 'healthy' } }, { TargetHealth: { State: 'unused' } }],
    });
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [{ DBInstanceStatus: 'rebooting' }] });
    cache.on(DescribeCacheClustersCommand).resolves({ CacheClusters: [{ CacheClusterStatus: 'modifying' }] });
    cloudwatch.on(DescribeAlarmsCommand).resolves({ MetricAlarms: [{ AlarmName: 'game-errors', StateValue: 'ALARM' }] });
    expect(await fisEnvironmentHealth(context, inventory, ['game-errors'])).toEqual([
      'game-api: 1 of 2 tasks running, 2 deployments',
      'game-proxy: 1 of 2 targets healthy',
      'Database game-db-1 is rebooting',
      'Cache node game-cache-001 is modifying',
      'Stop alarm game-errors is ALARM',
    ]);
  });

  it("counts a part it can't read as unhealthy, naming the permission to add", async () => {
    rds.on(DescribeDBClustersCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    cloudwatch.on(DescribeAlarmsCommand).rejects(Object.assign(new Error('slow'), { name: 'Throttling' }));
    expect(await fisEnvironmentHealth(context, inventory, ['game-errors'])).toEqual([
      "Can't check databases: add rds:DescribeDBClusters to the key's IAM policy",
      "Can't check stop alarms right now",
    ]);
  });
});

describe('fisRestartStopped', () => {
  beforeEach(() => ec2.reset());

  it('starts stopped servers and waits for ones still stopping', async () => {
    ec2.on(DescribeInstancesCommand).resolves({
      Reservations: [
        { Instances: [{ InstanceId: 'i-01', State: { Name: 'stopped' } }, { InstanceId: 'i-02', State: { Name: 'stopping' } }] },
        { Instances: [{ InstanceId: 'i-03', State: { Name: 'running' } }] },
      ],
    });
    ec2.on(StartInstancesCommand).resolves({});
    const outcome = await fisRestartStopped(context, ['arn:aws:ec2:eu-central-1:1:instance/i-01', 'i-02', 'i-03', 'arn:aws:rds:x']);
    expect(outcome).toEqual({ started: ['i-01'], waiting: ['i-02'] });
    expect(ec2.commandCalls(StartInstancesCommand)[0]?.args[0].input).toEqual({ InstanceIds: ['i-01'] });
  });

  it('keeps servers waiting when AWS refuses to start them, and does nothing without servers', async () => {
    ec2.on(DescribeInstancesCommand).resolves({ Reservations: [{ Instances: [{ InstanceId: 'i-01', State: { Name: 'stopped' } }] }] });
    ec2.on(StartInstancesCommand).rejects(new Error('no'));
    expect(await fisRestartStopped(context, ['i-01'])).toEqual({ started: [], waiting: ['i-01'] });
    expect(await fisRestartStopped(context, ['arn:aws:rds:x'])).toEqual({ started: [], waiting: [] });
  });
});
