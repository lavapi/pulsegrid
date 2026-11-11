import type { ResourceType } from './inventory';

export const LOAD_RANGES = [
  { id: '1h', label: '1 hour', minutes: 60, periodSeconds: 60 },
  { id: '6h', label: '6 hours', minutes: 360, periodSeconds: 300 },
  { id: '24h', label: '24 hours', minutes: 1440, periodSeconds: 300 },
  { id: '7d', label: '7 days', minutes: 10_080, periodSeconds: 3600 },
] as const;

export type LoadRange = (typeof LOAD_RANGES)[number];
export type LoadRangeId = LoadRange['id'];

export const LOAD_RESOURCE_TYPES: readonly ResourceType[] = [
  'ecs-service',
  'ec2-instance',
  'rds-instance',
  'rds-cluster',
  'elasticache-cluster',
  'elasticache-replication-group',
];

export const LOAD_SERIES_LIMIT = 3;

export type LoadUnit = 'percent' | 'count' | 'bytes' | 'milliseconds';

export interface LoadPoint {
  timestamp: string;
  value: number;
}

export interface LoadSeries {
  label: string;
  points: LoadPoint[];
}

export interface LoadChart {
  id: string;
  label: string;
  unit: LoadUnit;
  /** The most the value can reach, such as 100 for a percentage. */
  limit: number | null;
  /** Values above this are close to the limit. */
  warnAbove: number | null;
  /** What the values are out of, such as a database's total memory, shown as used / total. */
  total: number | null;
  /** A short explanation, such as "of 2 vCPUs". */
  note: string | null;
  series: LoadSeries[];
}

export interface CapacityFact {
  label: string;
  value: string;
}

export interface ResourceLoad {
  available: boolean;
  charts: LoadChart[];
  capacity: CapacityFact[];
  /** Nodes left out because a chart shows at most LOAD_SERIES_LIMIT lines. */
  hiddenSeries: number;
  error: string | null;
}

export const loadRange = (id: string): LoadRange | undefined => LOAD_RANGES.find((range) => range.id === id);

/** A fixed stretch of time to show load for, such as a failover test and the minutes around it. */
export interface LoadWindow {
  from: string;
  to: string;
}

export const LOAD_WINDOW_MAX_MINUTES = 10_080;

const DAY_MS = 24 * 60 * 60 * 1000;

/** CloudWatch keeps 1-minute data for 15 days and 5-minute data for 63, so older or longer windows use coarser points. */
export const windowPeriodSeconds = (since: Date, until: Date, now = new Date()): number => {
  const minutes = (until.getTime() - since.getTime()) / 60_000;
  const ageDays = (now.getTime() - since.getTime()) / DAY_MS;
  const byLength = minutes <= 360 ? 60 : minutes <= 1440 ? 300 : 3600;
  const byAge = ageDays > 63 ? 3600 : ageDays > 15 ? 300 : 60;
  return Math.max(byLength, byAge);
};

export const supportsLoad = (type: ResourceType): boolean => LOAD_RESOURCE_TYPES.includes(type);

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const BYTE_STEP = 1024;

export const trimmedNumber = (value: number, digits: number): string =>
  new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);

/** Sizes in 1024 steps, such as 2.5 GB, matching how AWS sizes memory and disks. */
export const formatBytes = (value: number): string => {
  let size = value;
  let index = 0;
  while (Math.abs(size) >= BYTE_STEP && index < BYTE_UNITS.length - 1) {
    size /= BYTE_STEP;
    index += 1;
  }
  return `${trimmedNumber(size, size < 10 ? 1 : 0)} ${BYTE_UNITS[index]}`;
};
