import type { CountedKey, RequestLogEntry } from '@pulsegrid/shared';
import { statusOf } from './request-log-filter';

const BUCKET_GROWTH = 1.02;
const LOG_GROWTH = Math.log(BUCKET_GROWTH);
const TOP_COUNT = 10;
const MAX_DISTINCT_KEYS = 50_000;
const SERVER_ERROR = 5;

/** Response times in buckets that grow by 2%, so percentiles stay within 2% using little memory. */
class LatencyHistogram {
  private readonly buckets = new Map<number, number>();
  private count = 0;

  add(ms: number): void {
    const bucket = Math.ceil(Math.log(ms + 1) / LOG_GROWTH);
    this.buckets.set(bucket, (this.buckets.get(bucket) ?? 0) + 1);
    this.count += 1;
  }

  percentile(share: number): number | null {
    if (this.count === 0) {
      return null;
    }
    const wanted = Math.ceil(this.count * share);
    let seen = 0;
    for (const [bucket, count] of [...this.buckets.entries()].sort(([a], [b]) => a - b)) {
      seen += count;
      if (seen >= wanted) {
        return Math.round((BUCKET_GROWTH ** bucket - 1) * 10) / 10;
      }
    }
    return null;
  }
}

/** Counts keys, keeping at most 50,000 different ones so a flood of unique paths can't use up memory. */
class KeyCounter {
  private readonly counts = new Map<string, number>();

  add(key: string): void {
    const current = this.counts.get(key);
    if (current !== undefined) {
      this.counts.set(key, current + 1);
    } else if (this.counts.size < MAX_DISTINCT_KEYS) {
      this.counts.set(key, 1);
    }
  }

  top(): CountedKey[] {
    return [...this.counts.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, TOP_COUNT)
      .map(([key, count]) => ({ key, count }));
  }
}

export interface RequestStats {
  requests: number;
  errorRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  topPaths: CountedKey[];
  topHosts: CountedKey[];
  noTarget: number;
}

/** Adds up requests one at a time, for the summary above the request log. */
export class RequestStatsCollector {
  private requests = 0;
  private serverErrors = 0;
  private noTarget = 0;
  private readonly latency = new LatencyHistogram();
  private readonly paths = new KeyCounter();
  private readonly hosts = new KeyCounter();

  constructor(private readonly showQuery: boolean) {}

  add = (entry: RequestLogEntry): void => {
    this.requests += 1;
    const status = statusOf(entry);
    if (status !== null && Math.floor(status / 100) === SERVER_ERROR) {
      this.serverErrors += 1;
    }
    if (entry.service === null) {
      this.noTarget += 1;
    }
    if (entry.responseMs !== null) {
      this.latency.add(entry.responseMs);
    }
    this.paths.add(this.showQuery ? entry.path : (entry.path.split('?')[0] ?? entry.path));
    this.hosts.add(entry.host || '(none)');
  };

  result(): RequestStats {
    return {
      requests: this.requests,
      errorRate: this.requests === 0 ? 0 : this.serverErrors / this.requests,
      p50Ms: this.latency.percentile(0.5),
      p95Ms: this.latency.percentile(0.95),
      p99Ms: this.latency.percentile(0.99),
      topPaths: this.paths.top(),
      topHosts: this.hosts.top(),
      noTarget: this.noTarget,
    };
  }
}
