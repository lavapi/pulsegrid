import { CloudWatchClient, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import {
  type CapacityFact,
  LOAD_RESOURCE_TYPES,
  LOAD_SERIES_LIMIT,
  type LoadChart,
  type LoadPoint,
  type LoadUnit,
  type ResourceType,
} from '@pulsegrid/shared';
import type { MetricContext, MetricQuery, MetricResult, MetricSource } from '../provider';
import { isAccessDenied } from './aws-error-messages';
import type { AwsKey } from './aws-key';

const RDS = 'AWS/RDS';
const ELASTICACHE = 'AWS/ElastiCache';
const BYTES_PER_GIB = 1024 ** 3;
const MS_PER_SECOND = 1000;
const FIRST_NODE = '0001';
const SERVERLESS_CLASS = 'db.serverless';
const MAX_PAGES = 5;
const NO_METRICS_PERMISSION = "This key can't read load. Add cloudwatch:GetMetricData to its IAM policy.";
const READ_FAILED = "We couldn't read the load from AWS. Please try again.";

interface MetricDefinition {
  id: string;
  label: string;
  unit: LoadUnit;
  metric: string;
  statistic: 'Average' | 'Sum';
  limit?: number;
  warnAbove?: number;
  scale?: (value: number) => number;
}

interface MetricTarget {
  label: string;
  dimensions: Record<string, string>;
}

interface MetricPlan {
  namespace: string;
  targets: MetricTarget[];
  definitions: MetricDefinition[];
  capacity: CapacityFact[];
}

const percent = (id: string, label: string, metric: string, warnAbove: number): MetricDefinition => ({
  id,
  label,
  unit: 'percent',
  metric,
  statistic: 'Average',
  limit: 100,
  warnAbove,
});

const CPU = percent('cpu', 'CPU', 'CPUUtilization', 80);
const SERVERLESS_CAPACITY = percent('serverless-capacity', 'Serverless capacity used', 'ACUUtilization', 80);
const DATABASE_CONNECTIONS: MetricDefinition = {
  id: 'connections',
  label: 'Connections',
  unit: 'count',
  metric: 'DatabaseConnections',
  statistic: 'Average',
};
const FREE_MEMORY: MetricDefinition = {
  id: 'free-memory',
  label: 'Free memory',
  unit: 'bytes',
  metric: 'FreeableMemory',
  statistic: 'Average',
};
const latency = (id: string, label: string, metric: string): MetricDefinition => ({
  id,
  label,
  unit: 'milliseconds',
  metric,
  statistic: 'Average',
  scale: (seconds) => seconds * MS_PER_SECOND,
});
const STORAGE_VOLUME: MetricDefinition = {
  id: 'storage',
  label: 'Storage used',
  unit: 'bytes',
  metric: 'VolumeBytesUsed',
  statistic: 'Average',
};
const storageUsed = (allocatedGb: number): MetricDefinition => ({
  ...percent('storage', 'Storage used', 'FreeStorageSpace', 85),
  scale: (free) => Math.min(100, Math.max(0, 100 - (free / (allocatedGb * BYTES_PER_GIB)) * 100)),
});
const CACHE_CPU = percent('cpu', 'CPU', 'CPUUtilization', 80);
const ENGINE_CPU = percent('engine-cpu', 'Engine CPU', 'EngineCPUUtilization', 90);
const CACHE_MEMORY = percent('memory', 'Memory used', 'DatabaseMemoryUsagePercentage', 90);
const CACHE_CONNECTIONS: MetricDefinition = {
  id: 'connections',
  label: 'Connections',
  unit: 'count',
  metric: 'CurrConnections',
  statistic: 'Average',
};
const EVICTIONS: MetricDefinition = {
  id: 'evictions',
  label: 'Evictions',
  unit: 'count',
  metric: 'Evictions',
  statistic: 'Sum',
};
const CACHE_DEFINITIONS = [CACHE_CPU, ENGINE_CPU, CACHE_MEMORY, CACHE_CONNECTIONS, EVICTIONS];

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const positive = (value: unknown): number | null =>
  typeof value === 'number' && value > 0 ? value : null;

const facts = (entries: [string, string | null][]): CapacityFact[] =>
  entries.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));

const engineOf = (details: Record<string, unknown>): string | null => {
  const engine = text(details['engine']);
  const version = text(details['engineVersion']);
  return engine && version ? `${engine} ${version}` : engine;
};

const serverlessRange = (details: Record<string, unknown>): string | null => {
  const max = positive(details['serverlessMaxAcu']);
  return max === null ? null : `${positive(details['serverlessMinAcu']) ?? 0}–${max} ACU`;
};

const rdsInstancePlan = (name: string, details: Record<string, unknown>): MetricPlan => {
  const instanceClass = text(details['instanceClass']);
  const allocatedGb = positive(details['storageGb']);
  const inCluster = text(details['cluster']) !== null;
  return {
    namespace: RDS,
    targets: [{ label: name, dimensions: { DBInstanceIdentifier: name } }],
    definitions: [
      CPU,
      ...(instanceClass === SERVERLESS_CLASS ? [SERVERLESS_CAPACITY] : []),
      FREE_MEMORY,
      ...(allocatedGb !== null && !inCluster ? [storageUsed(allocatedGb)] : []),
      DATABASE_CONNECTIONS,
      latency('read-latency', 'Read latency', 'ReadLatency'),
      latency('write-latency', 'Write latency', 'WriteLatency'),
    ],
    capacity: facts([
      ['Instance class', instanceClass],
      ['Engine', engineOf(details)],
      ['Allocated storage', allocatedGb === null || inCluster ? null : `${allocatedGb} GB`],
    ]),
  };
};

const rdsClusterPlan = (name: string, details: Record<string, unknown>): MetricPlan => {
  const serverless = serverlessRange(details);
  const members = positive(details['members']);
  return {
    namespace: RDS,
    targets: [{ label: name, dimensions: { DBClusterIdentifier: name } }],
    definitions: [
      CPU,
      ...(serverless ? [SERVERLESS_CAPACITY] : []),
      FREE_MEMORY,
      DATABASE_CONNECTIONS,
      STORAGE_VOLUME,
    ],
    capacity: facts([
      ['Instances', members === null ? null : String(members)],
      ['Serverless capacity', serverless],
      ['Engine', engineOf(details)],
    ]),
  };
};

const cacheNode = (clusterId: string, nodeId: string, label: string): MetricTarget => ({
  label,
  dimensions: { CacheClusterId: clusterId, CacheNodeId: nodeId },
});

const nodeId = (position: number): string => String(position).padStart(FIRST_NODE.length, '0');

const cacheClusterPlan = (name: string, details: Record<string, unknown>): MetricPlan => {
  const nodes = positive(details['nodes']) ?? 1;
  const targets =
    nodes === 1
      ? [cacheNode(name, FIRST_NODE, name)]
      : Array.from({ length: nodes }, (_, index) => cacheNode(name, nodeId(index + 1), `Node ${nodeId(index + 1)}`));
  return {
    namespace: ELASTICACHE,
    targets,
    definitions: CACHE_DEFINITIONS,
    capacity: facts([
      ['Node type', text(details['nodeType'])],
      ['Nodes', String(nodes)],
      ['Engine', engineOf(details)],
    ]),
  };
};

const replicationGroupPlan = (_name: string, details: Record<string, unknown>): MetricPlan => {
  const members = Array.isArray(details['memberClusters'])
    ? details['memberClusters'].filter((member): member is string => typeof member === 'string')
    : [];
  return {
    namespace: ELASTICACHE,
    targets: members.map((member) => cacheNode(member, FIRST_NODE, member)),
    definitions: CACHE_DEFINITIONS,
    capacity: facts([
      ['Node type', text(details['nodeType'])],
      ['Nodes', members.length > 0 ? String(members.length) : null],
    ]),
  };
};

const PLANS: Partial<Record<ResourceType, (name: string, details: Record<string, unknown>) => MetricPlan>> = {
  'rds-instance': rdsInstancePlan,
  'rds-cluster': rdsClusterPlan,
  'elasticache-cluster': cacheClusterPlan,
  'elasticache-replication-group': replicationGroupPlan,
};

const queryId = (definition: number, target: number): string => `m${definition}_${target}`;

const queriesFor = (
  { namespace, definitions }: MetricPlan,
  targets: readonly MetricTarget[],
  periodSeconds: number,
): MetricDataQuery[] =>
  definitions.flatMap((definition, definitionIndex) =>
    targets.map((target, targetIndex) => ({
      Id: queryId(definitionIndex, targetIndex),
      MetricStat: {
        Metric: {
          Namespace: namespace,
          MetricName: definition.metric,
          Dimensions: Object.entries(target.dimensions).map(([Name, Value]) => ({ Name, Value })),
        },
        Period: periodSeconds,
        Stat: definition.statistic,
      },
      ReturnData: true,
    })),
  );

const readPoints = async (
  client: CloudWatchClient,
  queries: MetricDataQuery[],
  { since, until }: MetricQuery,
): Promise<Map<string, LoadPoint[]>> => {
  const points = new Map<string, LoadPoint[]>();
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
    for (const { Id, Timestamps = [], Values = [] } of MetricDataResults) {
      const existing = points.get(Id ?? '') ?? [];
      const added = Timestamps.map((timestamp, index) => ({
        timestamp: timestamp.toISOString(),
        value: Values[index] ?? 0,
      }));
      points.set(Id ?? '', [...existing, ...added]);
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
): LoadChart => {
  const scale = definition.scale ?? ((value: number) => value);
  return {
    id: definition.id,
    label: definition.label,
    unit: definition.unit,
    limit: definition.limit ?? null,
    warnAbove: definition.warnAbove ?? null,
    series: targets.map((target, targetIndex) => ({
      label: target.label,
      points: (points.get(queryId(definitionIndex, targetIndex)) ?? [])
        .map(({ timestamp, value }) => ({ timestamp, value: scale(value) }))
        .sort((first, second) => first.timestamp.localeCompare(second.timestamp)),
    })),
  };
};

const hasData = ({ series }: LoadChart): boolean => series.some(({ points }) => points.length > 0);

export const AWS_METRIC_SOURCE: MetricSource<AwsKey> = {
  resourceTypes: LOAD_RESOURCE_TYPES,
  read: async ({ credentials, region, resource }: MetricContext<AwsKey>, query): Promise<MetricResult> => {
    const plan = PLANS[resource.type]?.(resource.name, resource.details);
    if (!plan || plan.targets.length === 0) {
      return { charts: [], capacity: plan?.capacity ?? [], hiddenSeries: 0 };
    }
    const targets = plan.targets.slice(0, LOAD_SERIES_LIMIT);
    const client = new CloudWatchClient({ region, credentials });
    const points = await readPoints(client, queriesFor(plan, targets, query.periodSeconds), query);
    return {
      charts: plan.definitions
        .map((definition, index) => toChart(definition, index, targets, points))
        .filter(hasData),
      capacity: plan.capacity,
      hiddenSeries: plan.targets.length - targets.length,
    };
  },
  failureMessage: (error) => (isAccessDenied(error) ? NO_METRICS_PERMISSION : READ_FAILED),
};
