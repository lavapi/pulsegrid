import { DescribeDimensionKeysCommand, GetResourceMetricsCommand, PIClient } from '@aws-sdk/client-pi';
import { type DBInstance, DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import type { InstanceTopSql, TopStatement } from '@pulsegrid/shared';
import type { DatabaseActivityContext } from '../../provider';
import { isAccessDenied } from '../aws-error-messages';
import type { AwsKey } from '../aws-key';

const SERVICE_TYPE = 'RDS';
const LOAD = 'db.load.avg';
const SQL_GROUP = 'db.sql_tokenized';
const WAIT_GROUP = 'db.wait_event';
const STATEMENT = 'db.sql_tokenized.statement';
const STATEMENT_ID = 'db.sql_tokenized.id';
const WAIT_NAME = 'db.wait_event.name';
const TOP_STATEMENTS = 10;
const TOP_WAITS = 3;
const INVALID_ARGUMENT = 'InvalidArgumentException';
const MS_PER_HOUR = 3_600_000;
const PI_OFF = 'Performance Insights is off for this instance.';
const PI_DENIED =
  "Add pi:DescribeDimensionKeys and pi:GetResourceMetrics to the key's IAM policy to see its busiest statements.";
const PI_FAILED = "Performance Insights didn't answer. Try again in a moment.";

/** Per-call statistics have different names for PostgreSQL and MySQL. */
const STATS = {
  postgres: {
    calls: 'db.sql_tokenized.stats.calls_per_sec.avg',
    latency: 'db.sql_tokenized.stats.total_time_per_call.avg',
  },
  mysql: {
    calls: 'db.sql_tokenized.stats.count_star_per_sec.avg',
    latency: 'db.sql_tokenized.stats.sum_timer_wait_per_call.avg',
  },
} as const;

type Context = DatabaseActivityContext<AwsKey>;

const statsFor = (engine: string | undefined) => (engine?.includes('mysql') ? STATS.mysql : STATS.postgres);

/** Performance Insights accepts a few period lengths; longer ranges use longer ones. */
const periodFor = (since: Date, until: Date): number => {
  const hours = (until.getTime() - since.getTime()) / MS_PER_HOUR;
  if (hours <= 1) {
    return 60;
  }
  if (hours <= 6) {
    return 300;
  }
  return hours <= 24 ? 3600 : 86400;
};

const round = (value: number, places = 3): number => Math.round(value * 10 ** places) / 10 ** places;

/** The cluster's instances, or the instance itself. */
export const instancesOf = async ({ region, credentials, resource }: Context): Promise<DBInstance[]> => {
  const rds = new RDSClient({ region, credentials });
  const { DBInstances = [] } = await rds.send(
    resource.type === 'rds-cluster'
      ? new DescribeDBInstancesCommand({ Filters: [{ Name: 'db-cluster-id', Values: [resource.name] }] })
      : new DescribeDBInstancesCommand({ DBInstanceIdentifier: resource.name }),
  );
  return [...DBInstances].sort((a, b) => (a.DBInstanceIdentifier ?? '').localeCompare(b.DBInstanceIdentifier ?? ''));
};

const averageLoad = async (client: PIClient, identifier: string, since: Date, until: Date): Promise<number | null> => {
  const { MetricList = [] } = await client.send(
    new GetResourceMetricsCommand({
      ServiceType: SERVICE_TYPE,
      Identifier: identifier,
      MetricQueries: [{ Metric: LOAD }],
      StartTime: since,
      EndTime: until,
      PeriodInSeconds: periodFor(since, until),
    }),
  );
  const values = (MetricList[0]?.DataPoints ?? []).flatMap(({ Value }) => (Value === undefined ? [] : [Value]));
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
};

const describeKeys = (client: PIClient, identifier: string, since: Date, until: Date, additional: string[]) =>
  client.send(
    new DescribeDimensionKeysCommand({
      ServiceType: SERVICE_TYPE,
      Identifier: identifier,
      StartTime: since,
      EndTime: until,
      Metric: LOAD,
      PeriodInSeconds: periodFor(since, until),
      GroupBy: { Group: SQL_GROUP, Limit: TOP_STATEMENTS },
      PartitionBy: { Group: WAIT_GROUP },
      ...(additional.length > 0 ? { AdditionalMetrics: additional } : {}),
    }),
  );

const topStatements = async (
  client: PIClient,
  instance: DBInstance,
  since: Date,
  until: Date,
  load: number | null,
): Promise<TopStatement[]> => {
  const identifier = instance.DbiResourceId ?? '';
  const stats = statsFor(instance.Engine);
  let response;
  try {
    response = await describeKeys(client, identifier, since, until, [stats.calls, stats.latency]);
  } catch (error) {
    if ((error as Error).name !== INVALID_ARGUMENT) {
      throw error;
    }
    response = await describeKeys(client, identifier, since, until, []);
  }
  const waitNames = (response.PartitionKeys ?? []).map(({ Dimensions = {} }) => Dimensions[WAIT_NAME] ?? 'Other');
  return (response.Keys ?? []).map(({ Dimensions = {}, Total = 0, Partitions = [], AdditionalMetrics = {} }) => ({
    id: Dimensions[STATEMENT_ID] ?? Dimensions[STATEMENT] ?? '',
    statement: Dimensions[STATEMENT] ?? '',
    load: round(Total),
    share: load && load > 0 ? Math.min(1, round(Total / load, 4)) : 0,
    waits: Partitions.map((value, index) => ({ name: waitNames[index] ?? 'Other', load: round(value) }))
      .filter(({ load: waiting }) => waiting > 0)
      .sort((a, b) => b.load - a.load)
      .slice(0, TOP_WAITS),
    callsPerSecond: AdditionalMetrics[stats.calls] === undefined ? null : round(AdditionalMetrics[stats.calls] ?? 0),
    avgLatencyMs:
      AdditionalMetrics[stats.latency] === undefined ? null : round(AdditionalMetrics[stats.latency] ?? 0, 2),
  }));
};

/** The busiest statements of each instance, one instance at a time so Performance Insights isn't flooded. */
export const piTopSql = async (context: Context, since: Date, until: Date): Promise<InstanceTopSql[]> => {
  const client = new PIClient({
    region: context.region,
    credentials: context.credentials,
    retryMode: 'adaptive',
    maxAttempts: 5,
  });
  const results: InstanceTopSql[] = [];
  for (const instance of await instancesOf(context)) {
    const name = instance.DBInstanceIdentifier ?? '';
    if (!instance.PerformanceInsightsEnabled || !instance.DbiResourceId) {
      results.push({ instance: name, unavailable: PI_OFF, load: null, statements: [] });
      continue;
    }
    try {
      const load = await averageLoad(client, instance.DbiResourceId, since, until);
      const statements = await topStatements(client, instance, since, until, load);
      results.push({ instance: name, unavailable: null, load: load === null ? null : round(load), statements });
    } catch (error) {
      results.push({
        instance: name,
        unavailable: isAccessDenied(error) ? PI_DENIED : PI_FAILED,
        load: null,
        statements: [],
      });
    }
  }
  return results;
};
