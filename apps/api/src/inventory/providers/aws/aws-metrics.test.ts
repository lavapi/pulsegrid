import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import type { ResourceType } from '@pulsegrid/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { AWS_METRIC_SOURCE } from './aws-metrics';

const cloudWatch = mockClient(CloudWatchClient);
const until = new Date('2026-11-10T12:00:00Z');
const query = { since: new Date('2026-11-10T11:00:00Z'), until, periodSeconds: 60 };
const GIB = 1024 ** 3;

const read = (type: ResourceType, details: Record<string, unknown>, name = 'db') =>
  AWS_METRIC_SOURCE.read(
    { credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, region: 'eu-central-1', resource: { type, name, details } },
    query,
  );

const sentQueries = (): MetricDataQuery[] =>
  cloudWatch.commandCalls(GetMetricDataCommand).flatMap(({ args }) => args[0].input.MetricDataQueries ?? []);

const metricNames = () => [...new Set(sentQueries().map(({ MetricStat }) => MetricStat?.Metric?.MetricName))];

/** Answers every query with one point, and the free storage query with 25 GiB free. */
const answerAll = () =>
  cloudWatch.on(GetMetricDataCommand).callsFake(({ MetricDataQueries = [] }: { MetricDataQueries: MetricDataQuery[] }) => ({
    MetricDataResults: MetricDataQueries.map(({ Id, MetricStat }) => ({
      Id,
      Timestamps: [until],
      Values: [MetricStat?.Metric?.MetricName === 'FreeStorageSpace' ? 25 * GIB : 0.004],
    })),
  }));

beforeEach(() => cloudWatch.reset());

describe('AWS_METRIC_SOURCE', () => {
  it('reads a database instance by its identifier, with storage as a share of what is allocated', async () => {
    answerAll();
    const result = await read('rds-instance', { instanceClass: 'db.t4g.medium', storageGb: 100, engine: 'postgres', engineVersion: '16.4' });
    expect(sentQueries()[0]?.MetricStat?.Metric?.Dimensions).toEqual([{ Name: 'DBInstanceIdentifier', Value: 'db' }]);
    expect(metricNames()).toEqual([
      'CPUUtilization',
      'FreeableMemory',
      'FreeStorageSpace',
      'DatabaseConnections',
      'ReadLatency',
      'WriteLatency',
    ]);
    const storage = result.charts.find(({ id }) => id === 'storage');
    expect(storage).toMatchObject({ unit: 'percent', limit: 100, warnAbove: 85 });
    expect(storage?.series[0]?.points[0]?.value).toBeCloseTo(75);
    expect(result.charts.find(({ id }) => id === 'read-latency')?.series[0]?.points[0]?.value).toBeCloseTo(4);
    expect(result.capacity).toEqual([
      { label: 'Instance class', value: 'db.t4g.medium' },
      { label: 'Engine', value: 'postgres 16.4' },
      { label: 'Allocated storage', value: '100 GB' },
    ]);
  });

  it('reads serverless capacity, and leaves out storage for cluster members', async () => {
    answerAll();
    await read('rds-instance', { instanceClass: 'db.serverless', storageGb: 1, cluster: 'aurora' });
    expect(metricNames()).toContain('ACUUtilization');
    expect(metricNames()).not.toContain('FreeStorageSpace');
  });

  it('reads an Aurora cluster with its serverless range', async () => {
    answerAll();
    const result = await read('rds-cluster', { members: 2, serverlessMinAcu: 0.5, serverlessMaxAcu: 8 });
    expect(sentQueries()[0]?.MetricStat?.Metric?.Dimensions).toEqual([{ Name: 'DBClusterIdentifier', Value: 'db' }]);
    expect(metricNames()).toContain('VolumeBytesUsed');
    expect(result.capacity).toContainEqual({ label: 'Serverless capacity', value: '0.5–8 ACU' });
  });

  it('shows one line per cache node, up to three', async () => {
    answerAll();
    const members = ['cache-001', 'cache-002', 'cache-003', 'cache-004'];
    const result = await read('elasticache-replication-group', { nodeType: 'cache.t4g.small', memberClusters: members }, 'cache');
    expect(result.hiddenSeries).toBe(1);
    const cpu = result.charts.find(({ id }) => id === 'cpu');
    expect(cpu?.series.map(({ label }) => label)).toEqual(['cache-001', 'cache-002', 'cache-003']);
    expect(sentQueries()[0]?.MetricStat?.Metric?.Dimensions).toEqual([
      { Name: 'CacheClusterId', Value: 'cache-001' },
      { Name: 'CacheNodeId', Value: '0001' },
    ]);
    expect(metricNames()).toEqual([
      'CPUUtilization',
      'EngineCPUUtilization',
      'DatabaseMemoryUsagePercentage',
      'CurrConnections',
      'Evictions',
    ]);
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
