import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { LOAD_RESOURCE_TYPES, LOAD_SERIES_LIMIT, type LoadChart, type LoadPoint } from '@pulsegrid/shared';
import type { MetricContext, MetricQuery, MetricResult, MetricSource } from '../provider';
import { isAccessDenied } from './aws-error-messages';
import type { AwsKey } from './aws-key';
import { type MetricDefinition, type MetricPlan, type MetricTarget, planFor } from './aws-metric-plans';

const MAX_PAGES = 5;
/** GetMetricData takes at most 500 queries in one request. */
const QUERIES_PER_REQUEST = 500;
const LATEST_WINDOW_MS = 10 * 60_000;
const LATEST_PERIOD_SECONDS = 60;
const NO_METRICS_PERMISSION = "This key can't read load. Add cloudwatch:GetMetricData to its IAM policy.";
const READ_FAILED = "We couldn't read the load from AWS. Please try again.";

/** Query ids are unique per request; the prefix keeps them apart when several resources share one. */
const queryId = (definition: number, target: number, prefix = ''): string => `${prefix}m${definition}_${target}`;

const queryFor = (
  namespace: string,
  definition: MetricDefinition,
  target: MetricTarget,
  periodSeconds: number,
): Omit<MetricDataQuery, 'Id'> =>
  definition.search
    ? { Expression: `SEARCH('${definition.search}', '${definition.statistic}', ${periodSeconds})` }
    : {
        MetricStat: {
          Metric: {
            Namespace: namespace,
            MetricName: definition.metric,
            Dimensions: Object.entries(target.dimensions).map(([Name, Value]) => ({ Name, Value })),
          },
          Period: periodSeconds,
          Stat: definition.statistic,
        },
      };

const queriesFor = (
  { namespace, definitions }: MetricPlan,
  targets: readonly MetricTarget[],
  periodSeconds: number,
  prefix = '',
): MetricDataQuery[] =>
  definitions.flatMap((definition, definitionIndex) =>
    targets.map((target, targetIndex) => ({
      Id: queryId(definitionIndex, targetIndex, prefix),
      ...queryFor(namespace, definition, target, periodSeconds),
      ReturnData: true,
    })),
  );

/** Points by query. A search can match more than one series; only the first is kept. */
const readPoints = async (
  client: CloudWatchClient,
  queries: MetricDataQuery[],
  { since, until }: MetricQuery,
): Promise<Map<string, LoadPoint[]>> => {
  const points = new Map<string, LoadPoint[]>();
  const labels = new Map<string, string>();
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { MetricDataResults = [], NextToken } = await client.send(
      new GetMetricDataCommand({
        MetricDataQueries: queries,
        StartTime: since,
        EndTime: until,
        ScanBy: 'TimestampAscending',
        NextToken: token,
      }),
    );
    for (const { Id = '', Label = '', Timestamps = [], Values = [] } of MetricDataResults) {
      if ((labels.get(Id) ?? Label) !== Label) {
        continue;
      }
      labels.set(Id, Label);
      const added = Timestamps.map((timestamp, index) => ({
        timestamp: timestamp.toISOString(),
        value: Values[index] ?? 0,
      }));
      points.set(Id, [...(points.get(Id) ?? []), ...added]);
    }
    token = NextToken;
    if (!token) {
      break;
    }
  }
  return points;
};

const toChart = (
  definition: MetricDefinition,
  definitionIndex: number,
  targets: readonly MetricTarget[],
  points: Map<string, LoadPoint[]>,
  prefix: string,
): LoadChart => {
  const scale = definition.scale ?? ((value: number) => value);
  return {
    id: definition.id,
    label: definition.label,
    unit: definition.unit,
    limit: definition.limit ?? null,
    warnAbove: definition.warnAbove ?? null,
    total: definition.total ?? null,
    note: definition.note ?? null,
    series: targets.map((target, targetIndex) => ({
      label: target.label,
      points: (points.get(queryId(definitionIndex, targetIndex, prefix)) ?? [])
        .map(({ timestamp, value }) => ({ timestamp, value: scale(value) }))
        .sort((first, second) => first.timestamp.localeCompare(second.timestamp)),
    })),
  };
};

const hasData = ({ series }: LoadChart): boolean => series.some(({ points }) => points.length > 0);

const shownTargets = (plan: MetricPlan): MetricTarget[] => plan.targets.slice(0, LOAD_SERIES_LIMIT);

/** The plan's charts from the points read, finished as the plan asks. */
const resultOf = (plan: MetricPlan, points: Map<string, LoadPoint[]>, prefix = ''): MetricResult => {
  const targets = shownTargets(plan);
  const charts = plan.definitions
    .map((definition, index) => toChart(definition, index, targets, points, prefix))
    .filter(hasData);
  const outcome = plan.finish ? plan.finish({ charts, capacity: plan.capacity }) : { charts, capacity: plan.capacity };
  return { ...outcome, hiddenSeries: plan.targets.length - targets.length };
};

/** Reads many queries, a request at a time within GetMetricData's limit. */
const readAllPoints = async (
  client: CloudWatchClient,
  queries: MetricDataQuery[],
  query: MetricQuery,
): Promise<Map<string, LoadPoint[]>> => {
  const points = new Map<string, LoadPoint[]>();
  for (let start = 0; start < queries.length; start += QUERIES_PER_REQUEST) {
    const read = await readPoints(client, queries.slice(start, start + QUERIES_PER_REQUEST), query);
    read.forEach((value, key) => points.set(key, value));
  }
  return points;
};

/** Keeps only the charts asked for, and the ones a plan needs to finish them, such as a cache's memory share. */
const narrowed = (plan: MetricPlan, chartIds: readonly string[]): MetricPlan => ({
  ...plan,
  definitions: plan.definitions.filter(({ id }) => chartIds.includes(id)),
});

export const AWS_METRIC_SOURCE: MetricSource<AwsKey> = {
  resourceTypes: LOAD_RESOURCE_TYPES,
  read: async ({ credentials, region, resource }: MetricContext<AwsKey>, query): Promise<MetricResult> => {
    const plan = await planFor({ credentials, region, resource });
    if (!plan || plan.targets.length === 0) {
      return { charts: [], capacity: plan?.capacity ?? [], hiddenSeries: 0 };
    }
    const client = new CloudWatchClient({ region, credentials });
    const points = await readPoints(client, queriesFor(plan, shownTargets(plan), query.periodSeconds), query);
    return resultOf(plan, points);
  },
  readLatest: async ({ credentials, region, resources }, chartIds, now = new Date()) => {
    const plans = await Promise.all(
      resources.map(async (resource) => {
        const plan = await planFor({ credentials, region, resource });
        return plan && plan.targets.length > 0 ? narrowed(plan, chartIds(resource.type)) : null;
      }),
    );
    const query = { since: new Date(now.getTime() - LATEST_WINDOW_MS), until: now, periodSeconds: LATEST_PERIOD_SECONDS };
    const queries = plans.flatMap((plan, index) =>
      plan ? queriesFor(plan, shownTargets(plan), query.periodSeconds, `r${index}`) : [],
    );
    const points = queries.length > 0 ? await readAllPoints(new CloudWatchClient({ region, credentials }), queries, query) : new Map();
    return plans.map((plan, index) => (plan ? resultOf(plan, points, `r${index}`) : null));
  },
  failureMessage: (error) => (isAccessDenied(error) ? NO_METRICS_PERMISSION : READ_FAILED),
};
