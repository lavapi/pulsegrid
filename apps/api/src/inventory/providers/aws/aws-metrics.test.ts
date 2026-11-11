import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { DescribeInstanceTypesCommand, DescribeVolumesCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DescribeTaskDefinitionCommand, ECSClient } from '@aws-sdk/client-ecs';
import { DescribeDBParametersCommand, RDSClient } from '@aws-sdk/client-rds';
import type { ResourceType } from '@pulsegrid/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { ec2TypeOf } from './aws-capacity';
import { AWS_METRIC_SOURCE } from './aws-metrics';

const cloudWatch = mockClient(CloudWatchClient);
const ec2 = mockClient(EC2Client);
const ecs = mockClient(ECSClient);
const rds = mockClient(RDSClient);
const until = new Date('2026-11-10T12:00:00Z');
const query = { since: new Date('2026-11-10T11:00:00Z'), until, periodSeconds: 60 };
const GIB = 1024 ** 3;

const read = (type: ResourceType, details: Record<string, unknown>, name = 'db', nativeId = name) =>
  AWS_METRIC_SOURCE.read(
    {
      credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
      region: 'eu-central-1',
      resource: { type, name, nativeId, details },
    },
    query,
  );

const sentQueries = (): MetricDataQuery[] =>
  cloudWatch.commandCalls(GetMetricDataCommand).flatMap(({ args }) => args[0].input.MetricDataQueries ?? []);

const metricNames = () =>
  [...new Set(sentQueries().map(({ MetricStat }) => MetricStat?.Metric?.MetricName))].filter(Boolean);

const VALUES: Record<string, number> = {
  FreeStorageSpace: 25 * GIB,
  FreeableMemory: 1 * GIB,
  BytesUsedForCache: 2.5 * GIB,
  DatabaseMemoryUsagePercentage: 25,
  MemoryUtilization: 50,
  mem_used_percent: 25,
  disk_used_percent: 40,
};

/** Answers every query with one point; searches only when the CloudWatch agent is said to be running. */
const answerAll = (agent = true) =>
  cloudWatch.on(GetMetricDataCommand).callsFake(({ MetricDataQueries = [] }: { MetricDataQueries: MetricDataQuery[] }) => ({
    MetricDataResults: MetricDataQueries.map(({ Id, MetricStat, Expression }) => {
      const name = MetricStat?.Metric?.MetricName ?? /MetricName="(\w+)"/.exec(Expression ?? '')?.[1] ?? '';
      if (Expression && !agent) {
        return { Id, Timestamps: [], Values: [] };
      }
      return { Id, Label: name, Timestamps: [until], Values: [VALUES[name] ?? 0.004] };
    }),
  }));

const instanceType = (type: string, vcpus: number, memoryMiB: number) =>
  ec2
    .on(DescribeInstanceTypesCommand, { InstanceTypes: [type as never] })
    .resolves({ InstanceTypes: [{ VCpuInfo: { DefaultVCpus: vcpus }, MemoryInfo: { SizeInMiB: memoryMiB } }] });

beforeEach(() => {
  cloudWatch.reset();
  ec2.reset();
  ecs.reset();
  rds.reset();
});

describe('ec2TypeOf', () => {
  it('drops the RDS and ElastiCache prefixes', () => {
    expect(ec2TypeOf('db.r6g.large')).toBe('r6g.large');
    expect(ec2TypeOf('cache.t4g.small')).toBe('t4g.small');
    expect(ec2TypeOf('m5.large')).toBe('m5.large');
  });
});

describe('AWS_METRIC_SOURCE', () => {
  it('shows a database instance memory and storage as used out of total, and its vCPUs', async () => {
    answerAll();
    instanceType('t4g.medium', 2, 4096);
    const result = await read('rds-instance', {
      instanceClass: 'db.t4g.medium',
      storageGb: 100,
      engine: 'postgres',
      engineVersion: '16.4',
    });
    expect(sentQueries()[0]?.MetricStat?.Metric?.Dimensions).toEqual([{ Name: 'DBInstanceIdentifier', Value: 'db' }]);
    expect(metricNames()).toEqual([
      'CPUUtilization',
      'FreeableMemory',
      'FreeStorageSpace',
      'DatabaseConnections',
      'ReadLatency',
      'WriteLatency',
    ]);
    const byId = Object.fromEntries(result.charts.map((chart) => [chart.id, chart]));
    expect(byId['cpu']).toMatchObject({ note: 'of 2 vCPUs' });
    expect(byId['memory']).toMatchObject({ unit: 'bytes', total: 4 * GIB, limit: 4 * GIB });
    expect(byId['memory']?.series[0]?.points[0]?.value).toBe(3 * GIB);
    expect(byId['storage']).toMatchObject({ unit: 'bytes', total: 100 * GIB, warnAbove: 85 * GIB });
    expect(byId['storage']?.series[0]?.points[0]?.value).toBe(75 * GIB);
    expect(byId['read-latency']?.series[0]?.points[0]?.value).toBeCloseTo(4);
    expect(result.capacity).toEqual([
      { label: 'Instance class', value: 'db.t4g.medium' },
      { label: 'vCPUs', value: '2' },
      { label: 'Memory', value: '4 GB' },
      { label: 'Engine', value: 'postgres 16.4' },
      { label: 'Allocated storage', value: '100 GB' },
    ]);
  });

  it('shows connections out of the limit set in the parameter group', async () => {
    answerAll();
    rds
      .on(DescribeDBParametersCommand, { DBParameterGroupName: 'app-postgres' })
      .resolvesOnce({ Parameters: [{ ParameterName: 'autovacuum', ParameterValue: '1' }], Marker: 'next' })
      .resolvesOnce({ Parameters: [{ ParameterName: 'max_connections', ParameterValue: '500' }] });
    const result = await read('rds-instance', { instanceClass: 'db.t4g.large', parameterGroup: 'app-postgres' });
    expect(result.charts.find(({ id }) => id === 'connections')).toMatchObject({
      total: 500,
      warnAbove: 400,
      note: 'limit from parameter group app-postgres',
    });
    expect(result.capacity).toContainEqual({ label: 'Max connections', value: '500' });
  });

  it('works out the default connection limit from the instance memory', async () => {
    answerAll();
    instanceType('r6g.large', 2, 16_384);
    rds.on(DescribeDBParametersCommand).resolves({
      Parameters: [{ ParameterName: 'max_connections', ParameterValue: 'LEAST({DBInstanceClassMemory/9531392},5000)' }],
    });
    const result = await read('rds-instance', { instanceClass: 'db.r6g.large', parameterGroup: 'default.postgres16' });
    expect(result.charts.find(({ id }) => id === 'connections')).toMatchObject({
      total: 1802,
      note: 'limit is about this, from the default for this instance size',
    });
    expect(result.capacity).toContainEqual({ label: 'Max connections', value: 'about 1,802' });
  });

  it('falls back to free memory when the key cannot look up instance types', async () => {
    answerAll();
    ec2.on(DescribeInstanceTypesCommand).rejects(Object.assign(new Error('denied'), { name: 'UnauthorizedOperation' }));
    const result = await read('rds-instance', { instanceClass: 'db.m7g.xlarge' });
    expect(result.charts.map(({ id }) => id)).toContain('free-memory');
    expect(result.capacity.map(({ label }) => label)).not.toContain('vCPUs');
  });

  it('reads serverless capacity, and leaves out storage for cluster members', async () => {
    answerAll();
    await read('rds-instance', { instanceClass: 'db.serverless', storageGb: 1, cluster: 'aurora' });
    expect(metricNames()).toContain('ACUUtilization');
    expect(metricNames()).not.toContain('FreeStorageSpace');
    expect(ec2.commandCalls(DescribeInstanceTypesCommand)).toHaveLength(0);
  });

  it('reads an Aurora cluster with its serverless range', async () => {
    answerAll();
    const result = await read('rds-cluster', { members: 2, serverlessMinAcu: 0.5, serverlessMaxAcu: 8 });
    expect(sentQueries()[0]?.MetricStat?.Metric?.Dimensions).toEqual([{ Name: 'DBClusterIdentifier', Value: 'db' }]);
    expect(result.charts.find(({ id }) => id === 'storage')).toMatchObject({
      total: null,
      note: 'grows by itself, up to 128 TB',
    });
    expect(result.capacity).toContainEqual({ label: 'Serverless capacity', value: '0.5–8 ACU' });
  });

  it('shows a cache memory as used out of its limit, one line per node up to three', async () => {
    answerAll();
    instanceType('t4g.small', 2, 2048);
    const members = ['cache-001', 'cache-002', 'cache-003', 'cache-004'];
    const result = await read(
      'elasticache-replication-group',
      { nodeType: 'cache.t4g.small', memberClusters: members },
      'cache',
    );
    expect(result.hiddenSeries).toBe(1);
    expect(sentQueries()[0]?.MetricStat?.Metric?.Dimensions).toEqual([
      { Name: 'CacheClusterId', Value: 'cache-001' },
      { Name: 'CacheNodeId', Value: '0001' },
    ]);
    expect(result.charts.map(({ id }) => id)).toEqual(['cpu', 'engine-cpu', 'memory', 'connections', 'evictions']);
    expect(result.charts[0]).toMatchObject({ note: 'of 2 vCPUs per node' });
    expect(result.charts[2]).toMatchObject({ unit: 'bytes', total: 10 * GIB, note: 'per node' });
    expect(result.capacity).toContainEqual({ label: 'Memory limit per node', value: '10 GB' });
    expect(result.charts.find(({ id }) => id === 'connections')).toMatchObject({ total: 65_000, note: 'per node' });
  });

  it('keeps the memory share when there is no memory in use to work the limit out from', async () => {
    cloudWatch.on(GetMetricDataCommand).resolves({
      MetricDataResults: [{ Id: 'm3_0', Label: 'share', Timestamps: [until], Values: [40] }],
    });
    const result = await read('elasticache-cluster', { nodes: 1 }, 'cache-001');
    expect(result.charts.map(({ id, unit }) => `${id}:${unit}`)).toEqual(['memory-share:percent']);
  });

  it('shows an ECS service against what its tasks reserve', async () => {
    answerAll();
    ecs
      .on(DescribeTaskDefinitionCommand)
      .resolves({ taskDefinition: { cpu: '512', memory: '1024', containerDefinitions: [] } });
    const result = await read(
      'ecs-service',
      { cluster: 'main', runningTasks: 2, taskDefinition: 'web:7', launchType: 'FARGATE' },
      'web',
    );
    expect(sentQueries()[0]?.MetricStat?.Metric).toMatchObject({
      Namespace: 'AWS/ECS',
      Dimensions: [
        { Name: 'ClusterName', Value: 'main' },
        { Name: 'ServiceName', Value: 'web' },
      ],
    });
    const [cpu, memory] = result.charts;
    expect(cpu).toMatchObject({ note: 'of 1 vCPU reserved (2 tasks × 0.5 vCPUs)' });
    expect(memory).toMatchObject({ total: 2 * GIB, note: '2 tasks × 1 GB reserved' });
    expect(memory?.series[0]?.points[0]?.value).toBe(1 * GIB);
    expect(result.capacity).toEqual([
      { label: 'Running tasks', value: '2' },
      { label: 'CPU per task', value: '0.5 vCPUs' },
      { label: 'Memory per task', value: '1 GB' },
      { label: 'Launch type', value: 'FARGATE' },
    ]);
  });

  it('adds up container reservations when a task has no task-level size', async () => {
    answerAll();
    ecs.on(DescribeTaskDefinitionCommand).resolves({
      taskDefinition: { containerDefinitions: [{ cpu: 256, memory: 512 }, { cpu: 256, memoryReservation: 512 }] },
    });
    const result = await read('ecs-service', { cluster: 'main', runningTasks: 1, taskDefinition: 'worker:3' }, 'worker');
    expect(result.capacity).toContainEqual({ label: 'Memory per task', value: '1 GB' });
  });

  it('shows a server with the CloudWatch agent as used out of total memory and root disk', async () => {
    answerAll();
    instanceType('m5.large', 2, 8192);
    ec2.on(DescribeVolumesCommand).resolves({
      Volumes: [
        { VolumeId: 'vol-root', Size: 30 },
        { VolumeId: 'vol-data', Size: 50 },
      ],
    });
    const result = await read(
      'ec2-instance',
      { instanceType: 'm5.large', volumeIds: ['vol-root', 'vol-data'], rootVolumeId: 'vol-root' },
      'api-1',
      'i-0abc12345def67890',
    );
    expect(sentQueries().flatMap(({ Expression }) => (Expression ? [Expression] : []))).toEqual([
      `SEARCH('Namespace="CWAgent" MetricName="mem_used_percent" InstanceId="i-0abc12345def67890"', 'Average', 60)`,
      `SEARCH('Namespace="CWAgent" MetricName="disk_used_percent" InstanceId="i-0abc12345def67890" path="/"', 'Average', 60)`,
    ]);
    const byId = Object.fromEntries(result.charts.map((chart) => [chart.id, chart]));
    expect(byId['cpu']).toMatchObject({ note: 'of 2 vCPUs' });
    expect(byId['memory']).toMatchObject({ total: 8 * GIB });
    expect(byId['memory']?.series[0]?.points[0]?.value).toBe(2 * GIB);
    expect(byId['disk']).toMatchObject({ total: 30 * GIB });
    expect(byId['disk']?.series[0]?.points[0]?.value).toBe(12 * GIB);
    expect(result.capacity).toEqual([
      { label: 'Instance type', value: 'm5.large' },
      { label: 'vCPUs', value: '2' },
      { label: 'Memory', value: '8 GB' },
      { label: 'Disks', value: '2 · 80 GB' },
    ]);
  });

  it('says a server needs the CloudWatch agent for memory and disk use', async () => {
    answerAll(false);
    const result = await read('ec2-instance', { instanceType: 'c7g.medium' }, 'api-2', 'i-0abc12345def67891');
    expect(result.charts.map(({ id }) => id)).toEqual(['cpu']);
    expect(result.capacity).toContainEqual({ label: 'RAM and disk use', value: 'Needs the CloudWatch agent on the server' });
  });

  it('never puts an unexpected instance ID into a search', async () => {
    const result = await read('ec2-instance', {}, 'odd', `i-1"') OR SEARCH('x`);
    expect(result.charts).toEqual([]);
    expect(cloudWatch.commandCalls(GetMetricDataCommand)).toHaveLength(0);
  });

  it('leaves out charts AWS has no data for, and follows every page', async () => {
    cloudWatch
      .on(GetMetricDataCommand)
      .resolvesOnce({
        MetricDataResults: [{ Id: 'm0_0', Timestamps: [new Date('2026-11-10T11:01:00Z')], Values: [30] }],
        NextToken: 'next',
      })
      .resolvesOnce({ MetricDataResults: [{ Id: 'm0_0', Timestamps: [until], Values: [50] }] });
    const result = await read('elasticache-cluster', { nodes: 1 }, 'cache-001');
    expect(result.charts.map(({ id }) => id)).toEqual(['cpu']);
    expect(result.charts[0]?.series[0]?.points.map(({ value }) => value)).toEqual([30, 50]);
  });

  it('reads nothing for a replication group without known members', async () => {
    const result = await read('elasticache-replication-group', {}, 'cache');
    expect(result.charts).toEqual([]);
    expect(cloudWatch.commandCalls(GetMetricDataCommand)).toHaveLength(0);
  });

  it('turns a missing permission into a readable message', () => {
    expect(AWS_METRIC_SOURCE.failureMessage(Object.assign(new Error('x'), { name: 'AccessDenied' }))).toContain(
      'cloudwatch:GetMetricData',
    );
    expect(AWS_METRIC_SOURCE.failureMessage(new Error('x'))).toBe("We couldn't read the load from AWS. Please try again.");
  });
});
