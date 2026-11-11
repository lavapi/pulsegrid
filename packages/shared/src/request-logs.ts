import type { LogAccess } from './logs';

/** The longest time range one request log read covers. */
export const REQUEST_LOG_MAX_MINUTES = 24 * 60;

export const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx'] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];

/** Why logs can't be read, in plain words, and who needs a grant when that's the reason. */
export interface LogProblem {
  message: string;
  /** The identity the bucket must grant, when the bucket refused it. */
  principal: string | null;
}

export interface RequestLogFilter {
  from: string;
  to: string;
  host?: string | undefined;
  path?: string | undefined;
  /** A status class such as 5xx, or an exact code such as 404. */
  status?: string | undefined;
  service?: string | undefined;
  minResponseMs?: number | undefined;
  userAgent?: string | undefined;
  /** Shows query strings in paths, for people allowed to see them. */
  showQuery?: boolean | undefined;
  /** Where the previous page ended, to read older requests. */
  before?: string | undefined;
}

export interface RequestLogEntry {
  time: string;
  host: string;
  method: string;
  path: string;
  elbStatus: number | null;
  targetStatus: number | null;
  /** Request, target and response processing time together; null when the request never reached a target. */
  responseMs: number | null;
  /** The target group the request went to, or null when the load balancer answered on its own. */
  service: string | null;
  userAgent: string;
  /** The address the request came from: with Cloudflare in front, this is Cloudflare's edge, not the visitor. */
  edgeIp: string;
  protocol: string;
}

export interface RequestLogPage {
  access: LogAccess;
  problem: LogProblem | null;
  entries: RequestLogEntry[];
  /** Pass as `before` to read the next, older page; null when the range is done. */
  older: string | null;
  canShowQuery: boolean;
}

export interface CountedKey {
  key: string;
  count: number;
}

export interface RequestLogSummary {
  access: LogAccess;
  problem: LogProblem | null;
  requests: number;
  /** Share of requests answered with a 5xx, from 0 to 1. */
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  topPaths: CountedKey[];
  topHosts: CountedKey[];
  /** Requests the load balancer answered without a target, such as an unknown host. */
  noTarget: number;
  /** True when the range had more files than one read covers, so the numbers are from the newest part. */
  partial: boolean;
}

export interface ConnectionLogEntry {
  time: string;
  edgeIp: string;
  listenerPort: number | null;
  tlsProtocol: string;
  tlsCipher: string;
  handshakeMs: number | null;
  /** Success, or why the handshake failed. */
  result: string;
}

export interface ConnectionLogPage {
  access: LogAccess;
  problem: LogProblem | null;
  entries: ConnectionLogEntry[];
  older: string | null;
}
