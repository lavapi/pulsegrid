import type { LogAccess } from './logs';
import type { LogProblem } from './request-logs';

export const QUERY_ACTIVITY_RANGES = [
  { id: '1h', label: '1 hour', minutes: 60 },
  { id: '6h', label: '6 hours', minutes: 360 },
  { id: '24h', label: '24 hours', minutes: 1440 },
  { id: '7d', label: '7 days', minutes: 10080 },
] as const;

export interface WaitShare {
  name: string;
  /** Average active sessions waiting on this event while running the statement. */
  load: number;
}

export interface TopStatement {
  id: string;
  /** The statement with its values replaced by placeholders, as Performance Insights groups it. */
  statement: string;
  /** Average active sessions. */
  load: number;
  /** Share of the instance's load, from 0 to 1. */
  share: number;
  waits: WaitShare[];
  callsPerSecond: number | null;
  avgLatencyMs: number | null;
}

export interface InstanceTopSql {
  instance: string;
  /** Why there's no list, such as Performance Insights being off. */
  unavailable: string | null;
  /** The instance's average active sessions over the range. */
  load: number | null;
  statements: TopStatement[];
}

export interface TopSqlView {
  access: LogAccess;
  problem: LogProblem | null;
  instances: InstanceTopSql[];
}

export const DATABASE_LOG_LEVELS = [
  { id: 'problems', label: 'Errors and warnings' },
  { id: 'errors', label: 'Errors' },
  { id: 'warnings', label: 'Warnings' },
  { id: 'deadlocks', label: 'Deadlocks' },
  { id: 'connections', label: 'Failed connections' },
  { id: 'all', label: 'Everything' },
] as const;
export type DatabaseLogLevel = (typeof DATABASE_LOG_LEVELS)[number]['id'];

export interface DatabaseLogLine {
  id: string;
  time: string;
  instance: string;
  severity: string;
  message: string;
}

export interface SlowQuery {
  id: string;
  time: string;
  instance: string;
  durationMs: number;
  statement: string;
}

export interface DatabaseLogView {
  access: LogAccess;
  problem: LogProblem | null;
  lines: DatabaseLogLine[];
  slowQueries: SlowQuery[];
  /** True when PulseGrid read as many lines as it reads at once, so older lines may be missing. */
  partial: boolean;
  /** Whether values in statements are shown as they are, instead of replaced with ?. */
  showsValues: boolean;
}
