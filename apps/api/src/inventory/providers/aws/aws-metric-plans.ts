import {
  type CapacityFact,
  formatBytes,
  type LoadChart,
  type LoadUnit,
  type ResourceType,
  trimmedNumber,
} from '@pulsegrid/shared';
import { diskSizes, type InstanceSpec, instanceSpec, maxConnectionsSetting, taskSize } from './aws-capacity';
import type { AwsKey } from './aws-key';
import { type ConnectionLimit, connectionLimit } from './connection-limit';

const RDS = 'AWS/RDS';
const ELASTICACHE = 'AWS/ElastiCache';
const ECS = 'AWS/ECS';
const EC2 = 'AWS/EC2';
const BYTES_PER_GIB = 1024 ** 3;
const MS_PER_SECOND = 1000;
const FIRST_NODE = '0001';
const SERVERLESS_CLASS = 'db.serverless';
const INSTANCE_ID = /^i-[0-9a-f]{8,17}$/;
const MEMORY_WARN_SHARE = 0.9;
const STORAGE_WARN_SHARE = 0.85;
const CONNECTIONS_WARN_SHARE = 0.8;
/** Redis and Valkey cap client connections at 65,000 per node, whatever the node type. */
const CACHE_MAX_CONNECTIONS = 65_000;
const NEEDS_AGENT = 'Needs the CloudWatch agent on the server';

export interface MetricDefinition {
  id: string;
  label: string;
  unit: LoadUnit;
  statistic: 'Average' | 'Sum';
  /** A metric in the plan's namespace, read for each target. */
  metric?: string;
  /** A CloudWatch search, for metrics whose dimensions vary, such as the CloudWatch agent's. */
  search?: string;
  limit?: number;
  warnAbove?: number;
  scale?: (value: number) => number;
  total?: number;
  note?: string;
}

export interface MetricTarget {
  label: string;
  dimensions: Record<string, string>;
}

export interface PlanOutcome {
  charts: LoadChart[];
  capacity: CapacityFact[];
}

export interface MetricPlan {
  namespace: string;
  targets: MetricTarget[];
  definitions: MetricDefinition[];
  capacity: CapacityFact[];
  /** Adjusts the charts once their points are read, such as working out a total from two metrics. */
  finish?: (outcome: PlanOutcome) => PlanOutcome;
}

export interface PlanInput {
  credentials: AwsKey;
  region: string;
  resource: { type: ResourceType; name: string; nativeId: string; details: Record<string, unknown> };
}

const share = (id: string, label: string, warnAbove: number): MetricDefinition => ({
  id,
  label,
  unit: 'percent',
  statistic: 'Average',
  limit: 100,
  warnAbove,
});

const percent = (id: string, label: string, metric: string, warnAbove: number): MetricDefinition => ({
  ...share(id, label, warnAbove),
  metric,
});

/** A chart of bytes used out of a known total, shown as used / total. */
const usedOf = (
  base: Pick<MetricDefinition, 'id' | 'label' | 'metric' | 'search' | 'note'>,
  total: number,
  toUsed: (value: number) => number,
  warnShare = MEMORY_WARN_SHARE,
): MetricDefinition => ({
  ...base,
  unit: 'bytes',
  statistic: 'Average',
  scale: (value) => Math.max(0, toUsed(value)),
  total,
  limit: total,
  warnAbove: total * warnShare,
});

const fromPercent = (total: number) => (share: number) => (share / 100) * total;

const vcpuText = (vcpus: number): string => `${trimmedNumber(vcpus, 2)} vCPU${vcpus === 1 ? '' : 's'}`;

const withNote = (definition: MetricDefinition, note: string | null): MetricDefinition =>
  note ? { ...definition, note } : definition;

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
  note: 'grows by itself, up to 128 TB',
};
const ENGINE_CPU = percent('engine-cpu', 'Engine CPU', 'EngineCPUUtilization', 90);
const CACHE_MEMORY_BYTES: MetricDefinition = {
  id: 'memory',
  label: 'Memory used',
  unit: 'bytes',
  metric: 'BytesUsedForCache',
  statistic: 'Average',
};
const CACHE_MEMORY_SHARE = percent('memory-share', 'Memory used', 'DatabaseMemoryUsagePercentage', 90);
const CACHE_CONNECTIONS: MetricDefinition = {
  id: 'connections',
  label: 'Connections',
  unit: 'count',
  metric: 'CurrConnections',
  statistic: 'Average',
  total: CACHE_MAX_CONNECTIONS,
  limit: CACHE_MAX_CONNECTIONS,
  warnAbove: CACHE_MAX_CONNECTIONS * CONNECTIONS_WARN_SHARE,
  note: 'per node',
};

const connectionsOutOf = (limit: ConnectionLimit | null, parameterGroup: string | null): MetricDefinition =>
  limit
    ? {
        ...DATABASE_CONNECTIONS,
        total: limit.value,
        limit: limit.value,
        warnAbove: limit.value * CONNECTIONS_WARN_SHARE,
        note: limit.estimated
          ? 'limit is about this, from the default for this instance size'
          : `limit from parameter group ${parameterGroup}`,
      }
    : DATABASE_CONNECTIONS;

const limitText = (limit: ConnectionLimit | null): string | null =>
  limit ? `${limit.estimated ? 'about ' : ''}${trimmedNumber(limit.value, 0)}` : null;
const EVICTIONS: MetricDefinition = {
  id: 'evictions',
  label: 'Evictions',
  unit: 'count',
  metric: 'Evictions',
  statistic: 'Sum',
};

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const positive = (value: unknown): number | null =>
  typeof value === 'number' && value > 0 ? value : null;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const facts = (entries: [string, string | null][]): CapacityFact[] =>
  entries.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));

const specFacts = (spec: InstanceSpec | null, suffix = ''): [string, string | null][] => [
  [`vCPUs${suffix}`, spec ? trimmedNumber(spec.vcpus, 2) : null],
  [`Memory${suffix}`, spec ? formatBytes(spec.memoryBytes) : null],
];

const engineOf = (details: Record<string, unknown>): string | null => {
  const engine = text(details['engine']);
  const version = text(details['engineVersion']);
  return engine && version ? `${engine} ${version}` : engine;
};

const serverlessRange = (details: Record<string, unknown>): string | null => {
  const max = positive(details['serverlessMaxAcu']);
  return max === null ? null : `${positive(details['serverlessMinAcu']) ?? 0}–${max} ACU`;
};

const rdsInstancePlan = async (input: PlanInput): Promise<MetricPlan> => {
  const { name, details } = input.resource;
  const instanceClass = text(details['instanceClass']);
  const serverless = instanceClass === SERVERLESS_CLASS;
  const allocatedGb = positive(details['storageGb']);
  const inCluster = text(details['cluster']) !== null;
  const parameterGroup = text(details['parameterGroup']);
  const [spec, setting] = await Promise.all([
    instanceClass && !serverless ? instanceSpec(input, instanceClass) : null,
    parameterGroup ? maxConnectionsSetting(input, parameterGroup) : null,
  ]);
  const limit = connectionLimit(setting, spec?.memoryBytes ?? null);
  const storage =
    allocatedGb !== null && !inCluster
      ? [
          usedOf(
            { id: 'storage', label: 'Storage used', metric: 'FreeStorageSpace' },
            allocatedGb * BYTES_PER_GIB,
            (free) => allocatedGb * BYTES_PER_GIB - free,
            STORAGE_WARN_SHARE,
          ),
        ]
      : [];
  return {
    namespace: RDS,
    targets: [{ label: name, dimensions: { DBInstanceIdentifier: name } }],
    definitions: [
      withNote(CPU, spec && `of ${vcpuText(spec.vcpus)}`),
      ...(serverless ? [SERVERLESS_CAPACITY] : []),
      spec
        ? usedOf({ id: 'memory', label: 'Memory used', metric: 'FreeableMemory' }, spec.memoryBytes, (free) => spec.memoryBytes - free)
        : FREE_MEMORY,
      ...storage,
      connectionsOutOf(limit, parameterGroup),
      latency('read-latency', 'Read latency', 'ReadLatency'),
      latency('write-latency', 'Write latency', 'WriteLatency'),
    ],
    capacity: facts([
      ['Instance class', instanceClass],
      ...specFacts(spec),
      ['Max connections', limitText(limit)],
      ['Engine', engineOf(details)],
      ['Allocated storage', allocatedGb === null || inCluster ? null : formatBytes(allocatedGb * BYTES_PER_GIB)],
    ]),
  };
};

const rdsClusterPlan = async ({ resource: { name, details } }: PlanInput): Promise<MetricPlan> => {
  const serverless = serverlessRange(details);
  const members = positive(details['members']);
  return {
    namespace: RDS,
    targets: [{ label: name, dimensions: { DBClusterIdentifier: name } }],
    definitions: [CPU, ...(serverless ? [SERVERLESS_CAPACITY] : []), FREE_MEMORY, DATABASE_CONNECTIONS, STORAGE_VOLUME],
    capacity: facts([
      ['Instances', members === null ? null : String(members)],
      ['Serverless capacity', serverless],
      ['Engine', engineOf(details)],
    ]),
  };
};

const latestOf = (chart: LoadChart | undefined, series: number): number | null =>
  chart?.series[series]?.points.at(-1)?.value ?? null;

/** A cache's memory limit is what's in use divided by the share of the limit AWS reports as used. */
const cacheMemoryLimit = (bytes: LoadChart | undefined, share: LoadChart | undefined): number | null => {
  for (let index = 0; index < (bytes?.series.length ?? 0); index += 1) {
    const used = latestOf(bytes, index);
    const ratio = latestOf(share, index);
    if (used !== null && ratio !== null && ratio > 0) {
      return used / (ratio / 100);
    }
  }
  return null;
};

const withCacheMemoryTotal = ({ charts, capacity }: PlanOutcome): PlanOutcome => {
  const bytes = charts.find(({ id }) => id === CACHE_MEMORY_BYTES.id);
  const share = charts.find(({ id }) => id === CACHE_MEMORY_SHARE.id);
  const limit = cacheMemoryLimit(bytes, share);
  if (limit === null) {
    return { charts: charts.filter((chart) => chart !== bytes), capacity };
  }
  const memory: LoadChart = {
    ...(bytes as LoadChart),
    total: limit,
    limit,
    warnAbove: limit * MEMORY_WARN_SHARE,
    note: (bytes?.series.length ?? 0) > 1 ? 'per node' : null,
  };
  return {
    charts: charts.flatMap((chart) => (chart === share ? [] : chart === bytes ? [memory] : [chart])),
    capacity: [...capacity, { label: 'Memory limit per node', value: formatBytes(limit) }],
  };
};

const cachePlan = async (
  input: PlanInput,
  targets: MetricTarget[],
  capacity: [string, string | null][],
): Promise<MetricPlan> => {
  const nodeType = text(input.resource.details['nodeType']);
  const spec = nodeType ? await instanceSpec(input, nodeType) : null;
  return {
    namespace: ELASTICACHE,
    targets,
    definitions: [
      withNote(CPU, spec && `of ${vcpuText(spec.vcpus)} per node`),
      ENGINE_CPU,
      CACHE_MEMORY_BYTES,
      CACHE_MEMORY_SHARE,
      CACHE_CONNECTIONS,
      EVICTIONS,
    ],
    capacity: facts([
      ['Node type', nodeType],
      ['vCPUs per node', spec ? trimmedNumber(spec.vcpus, 2) : null],
      ['Max connections per node', trimmedNumber(CACHE_MAX_CONNECTIONS, 0)],
      ...capacity,
    ]),
    finish: withCacheMemoryTotal,
  };
};

const cacheNode = (clusterId: string, nodeId: string, label: string): MetricTarget => ({
  label,
  dimensions: { CacheClusterId: clusterId, CacheNodeId: nodeId },
});

const nodeId = (position: number): string => String(position).padStart(FIRST_NODE.length, '0');

const cacheClusterPlan = (input: PlanInput): Promise<MetricPlan> => {
  const { name, details } = input.resource;
  const nodes = positive(details['nodes']) ?? 1;
  const targets =
    nodes === 1
      ? [cacheNode(name, FIRST_NODE, name)]
      : Array.from({ length: nodes }, (_, index) => cacheNode(name, nodeId(index + 1), `Node ${nodeId(index + 1)}`));
  return cachePlan(input, targets, [
    ['Nodes', String(nodes)],
    ['Engine', engineOf(details)],
  ]);
};

const replicationGroupPlan = (input: PlanInput): Promise<MetricPlan> => {
  const members = strings(input.resource.details['memberClusters']);
  return cachePlan(
    input,
    members.map((member) => cacheNode(member, FIRST_NODE, member)),
    [['Nodes', members.length > 0 ? String(members.length) : null]],
  );
};

/** ECS reports CPU and memory as a share of what the tasks reserve, so totals are tasks × reservation. */
const ecsServicePlan = async (input: PlanInput): Promise<MetricPlan> => {
  const { name, details } = input.resource;
  const cluster = text(details['cluster']);
  const taskDefinition = text(details['taskDefinition']);
  const size = taskDefinition ? await taskSize(input, taskDefinition) : null;
  const tasks = positive(details['runningTasks']) ?? 0;
  const reserved = size && tasks > 0 ? { vcpus: size.vcpus * tasks, memoryBytes: size.memoryBytes * tasks } : null;
  const perTask = size && tasks > 0 ? `${tasks} task${tasks === 1 ? '' : 's'} × ` : '';
  return {
    namespace: ECS,
    targets: cluster ? [{ label: name, dimensions: { ClusterName: cluster, ServiceName: name } }] : [],
    definitions: [
      withNote(CPU, size && reserved ? `of ${vcpuText(reserved.vcpus)} reserved (${perTask}${vcpuText(size.vcpus)})` : null),
      reserved && size
        ? usedOf(
            { id: 'memory', label: 'Memory used', metric: 'MemoryUtilization', note: `${perTask}${formatBytes(size.memoryBytes)} reserved` },
            reserved.memoryBytes,
            fromPercent(reserved.memoryBytes),
          )
        : percent('memory', 'Memory used', 'MemoryUtilization', 90),
    ],
    capacity: facts([
      ['Running tasks', String(tasks)],
      ['CPU per task', size ? vcpuText(size.vcpus) : null],
      ['Memory per task', size ? formatBytes(size.memoryBytes) : null],
      ['Launch type', text(details['launchType'])],
    ]),
  };
};

const agentSearch = (metric: string, instanceId: string, extra = ''): string =>
  `Namespace="CWAgent" MetricName="${metric}" InstanceId="${instanceId}"${extra}`;

const withAgentNote = ({ charts, capacity }: PlanOutcome): PlanOutcome =>
  charts.some(({ id }) => id === 'memory')
    ? { charts, capacity }
    : { charts, capacity: [...capacity, { label: 'RAM and disk use', value: NEEDS_AGENT }] };

/** EC2 doesn't measure memory or disk use itself; those charts appear when the CloudWatch agent sends them. */
const ec2InstancePlan = async (input: PlanInput): Promise<MetricPlan> => {
  const { name, nativeId, details } = input.resource;
  if (!INSTANCE_ID.test(nativeId)) {
    return { namespace: EC2, targets: [], definitions: [], capacity: [] };
  }
  const type = text(details['instanceType']);
  const [spec, disks] = await Promise.all([
    type ? instanceSpec(input, type) : null,
    diskSizes(input, strings(details['volumeIds']), text(details['rootVolumeId'])),
  ]);
  const memorySearch = agentSearch('mem_used_percent', nativeId);
  const diskSearch = agentSearch('disk_used_percent', nativeId, ' path="/"');
  return {
    namespace: EC2,
    targets: [{ label: name, dimensions: { InstanceId: nativeId } }],
    definitions: [
      withNote(CPU, spec && `of ${vcpuText(spec.vcpus)}`),
      spec
        ? usedOf({ id: 'memory', label: 'Memory used', search: memorySearch }, spec.memoryBytes, fromPercent(spec.memoryBytes))
        : { ...share('memory', 'Memory used', 90), search: memorySearch },
      disks?.rootBytes
        ? usedOf(
            { id: 'disk', label: 'Root disk used', search: diskSearch },
            disks.rootBytes,
            fromPercent(disks.rootBytes),
            STORAGE_WARN_SHARE,
          )
        : { ...share('disk', 'Root disk used', 85), search: diskSearch },
    ],
    capacity: facts([
      ['Instance type', type],
      ...specFacts(spec),
      ['Disks', disks ? `${disks.count} · ${formatBytes(disks.totalBytes)}` : null],
    ]),
    finish: withAgentNote,
  };
};

const PLANS: Partial<Record<ResourceType, (input: PlanInput) => Promise<MetricPlan>>> = {
  'ecs-service': ecsServicePlan,
  'ec2-instance': ec2InstancePlan,
  'rds-instance': rdsInstancePlan,
  'rds-cluster': rdsClusterPlan,
  'elasticache-cluster': cacheClusterPlan,
  'elasticache-replication-group': replicationGroupPlan,
};

export const planFor = (input: PlanInput): Promise<MetricPlan> | null => PLANS[input.resource.type]?.(input) ?? null;
