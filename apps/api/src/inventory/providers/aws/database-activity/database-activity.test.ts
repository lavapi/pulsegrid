import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { DescribeDimensionKeysCommand, GetResourceMetricsCommand, PIClient } from '@aws-sdk/client-pi';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { piTopSql } from './pi-top-sql';
import { postgresLogTarget, rdsPostgresLog } from './rds-postgres-log';

const credentials = { accessKeyId: 'a', secretAccessKey: 'b' };
const cluster = {
  credentials,
  region: 'eu-central-1',
  resource: { type: 'rds-cluster' as const, name: 'game-postgres', details: { engine: 'aurora-postgresql' } },
};
const since = new Date('2026-11-11T09:00:00Z');
const until = new Date('2026-11-11T10:00:00Z');

const pi = mockClient(PIClient);
const rds = mockClient(RDSClient);
const logs = mockClient(CloudWatchLogsClient);

describe('piTopSql', () => {
  beforeEach(() => {
    [pi, rds, logs].forEach((client) => client.reset());
    rds.on(DescribeDBInstancesCommand).resolves({
      DBInstances: [
        { DBInstanceIdentifier: 'game-postgres-2', DbiResourceId: 'db-B', PerformanceInsightsEnabled: false },
        { DBInstanceIdentifier: 'game-postgres-1', DbiResourceId: 'db-A', PerformanceInsightsEnabled: true, Engine: 'aurora-postgresql' },
      ],
    });
    pi.on(GetResourceMetricsCommand).resolves({ MetricList: [{ DataPoints: [{ Timestamp: since, Value: 1 }, { Timestamp: until, Value: 3 }] }] });
    pi.on(DescribeDimensionKeysCommand).resolves({
      PartitionKeys: [{ Dimensions: { 'db.wait_event.name': 'CPU' } }, { Dimensions: { 'db.wait_event.name': 'IO:DataFileRead' } }],
      Keys: [
        {
          Dimensions: { 'db.sql_tokenized.statement': 'SELECT * FROM players WHERE id = ?', 'db.sql_tokenized.id': 'S1' },
          Total: 1.5,
          Partitions: [1.2, 0.3],
          AdditionalMetrics: {
            'db.sql_tokenized.stats.calls_per_sec.avg': 40.25,
            'db.sql_tokenized.stats.total_time_per_call.avg': 3.456,
          },
        },
      ],
    });
  });

  it("lists each instance's busiest statements with their share of load, waits, calls and latency", async () => {
    const result = await piTopSql(cluster, since, until);
    expect(result).toEqual([
      {
        instance: 'game-postgres-1',
        unavailable: null,
        load: 2,
        statements: [
          {
            id: 'S1',
            statement: 'SELECT * FROM players WHERE id = ?',
            load: 1.5,
            share: 0.75,
            waits: [
              { name: 'CPU', load: 1.2 },
              { name: 'IO:DataFileRead', load: 0.3 },
            ],
            callsPerSecond: 40.25,
            avgLatencyMs: 3.46,
          },
        ],
      },
      { instance: 'game-postgres-2', unavailable: 'Performance Insights is off for this instance.', load: null, statements: [] },
    ]);
    expect(rds.commandCalls(DescribeDBInstancesCommand)[0]?.args[0].input).toEqual({
      Filters: [{ Name: 'db-cluster-id', Values: ['game-postgres'] }],
    });
    expect(pi.commandCalls(DescribeDimensionKeysCommand)[0]?.args[0].input).toMatchObject({
      Identifier: 'db-A',
      Metric: 'db.load.avg',
      GroupBy: { Group: 'db.sql_tokenized', Limit: 10 },
      PeriodInSeconds: 60,
    });
  });

  it('asks again without per-call statistics when the engine has none, and explains a refusal', async () => {
    pi.on(DescribeDimensionKeysCommand)
      .rejectsOnce(Object.assign(new Error('raw'), { name: 'InvalidArgumentException' }))
      .resolves({ Keys: [{ Dimensions: { 'db.sql_tokenized.statement': 'SELECT ?' }, Total: 0.5 }] });
    const [first] = await piTopSql(cluster, since, until);
    expect(first?.statements[0]).toMatchObject({ statement: 'SELECT ?', callsPerSecond: null, avgLatencyMs: null });

    pi.on(GetResourceMetricsCommand).rejects(Object.assign(new Error('raw'), { name: 'AccessDeniedException' }));
    const [denied] = await piTopSql(cluster, since, until);
    expect(denied?.unavailable).toBe(
      "Add pi:DescribeDimensionKeys and pi:GetResourceMetrics to the key's IAM policy to see its busiest statements.",
    );
  });
});

describe('rdsPostgresLog', () => {
  beforeEach(() => logs.reset());

  it('finds the log group of a cluster, a cluster member and a lone instance', () => {
    expect(postgresLogTarget(cluster)).toEqual({ group: '/aws/rds/cluster/game-postgres/postgresql', prefix: undefined });
    const member = { ...cluster, resource: { type: 'rds-instance' as const, name: 'game-postgres-1', details: { cluster: 'game-postgres' } } };
    expect(postgresLogTarget(member)).toEqual({ group: '/aws/rds/cluster/game-postgres/postgresql', prefix: 'game-postgres-1' });
    const lone = { ...cluster, resource: { type: 'rds-instance' as const, name: 'reports', details: {} } };
    expect(postgresLogTarget(lone)).toEqual({ group: '/aws/rds/instance/reports/postgresql', prefix: undefined });
  });

  it('reads with FilterLogEvents and the severity pattern, naming the instance of each line', async () => {
    const event = { eventId: '1', timestamp: Date.parse('2026-11-11T09:59:00Z'), logStreamName: 'game-postgres-1', message: 'x:ERROR:  boom' };
    logs.on(FilterLogEventsCommand).callsFake(({ startTime = 0, endTime = 0 }) => ({
      events: event.timestamp >= startTime && event.timestamp <= endTime ? [event] : [],
    }));
    const { lines, partial } = await rdsPostgresLog(cluster, { since, until, level: 'errors' });
    expect(lines).toEqual([{ id: '1', time: '2026-11-11T09:59:00.000Z', instance: 'game-postgres-1', message: 'x:ERROR:  boom' }]);
    expect(partial).toBe(false);
    expect(logs.commandCalls(FilterLogEventsCommand)[0]?.args[0].input).toMatchObject({
      logGroupName: '/aws/rds/cluster/game-postgres/postgresql',
      filterPattern: '?ERROR ?FATAL ?PANIC',
    });
  });

  it("explains a log that isn't exported, and engines it doesn't read", async () => {
    logs.on(FilterLogEventsCommand).rejects(Object.assign(new Error('raw'), { name: 'ResourceNotFoundException' }));
    await expect(rdsPostgresLog(cluster, { since, until, level: 'all' })).rejects.toThrow(
      "This database doesn't send its PostgreSQL log to CloudWatch Logs.",
    );
    const mysql = { ...cluster, resource: { ...cluster.resource, details: { engine: 'aurora-mysql' } } };
    await expect(rdsPostgresLog(mysql, { since, until, level: 'all' })).rejects.toThrow('Only PostgreSQL logs are shown for now.');
  });
});
