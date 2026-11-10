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

export const supportsLoad = (type: ResourceType): boolean => LOAD_RESOURCE_TYPES.includes(type);
