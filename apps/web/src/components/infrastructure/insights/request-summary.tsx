import type { CountedKey, RequestLogSummary } from '@pulsegrid/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { StatTile } from '@/components/ui/stat-tile';
import { formatMs, formatShare } from '@/lib/resource-logs';

function TopList({ title, items }: { title: string; items: CountedKey[] }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card">
      <h3 className="border-b px-4 py-2 text-[13px] font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-[13px] text-muted-foreground">None</p>
      ) : (
        <ol className="divide-y text-[13px]">
          {items.map(({ key, count }) => (
            <li key={key} className="flex items-center justify-between gap-3 px-4 py-1.5">
              <span className="min-w-0 truncate font-mono text-xs" title={key}>
                {key}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{count.toLocaleString('en-GB')}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Requests, 5xx rate, response time percentiles and the busiest paths and hosts in the range. */
export function RequestSummary({ summary }: { summary: RequestLogSummary | null }) {
  if (!summary) {
    return (
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Loading the summary">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }
  if (summary.problem) {
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      {summary.partial && (
        <p className="text-[13px] text-warning">
          This range has more log files than one read covers, so the summary is from its newest part. Choose a shorter
          range for exact numbers.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Requests" value={summary.requests.toLocaleString('en-GB')} />
        <StatTile
          label="5xx rate"
          value={formatShare(summary.errorRate)}
          tone={summary.errorRate >= 0.01 ? 'danger' : 'default'}
        />
        <StatTile label="p50" value={formatMs(summary.p50Ms)} />
        <StatTile label="p95" value={formatMs(summary.p95Ms)} />
        <StatTile label="p99" value={formatMs(summary.p99Ms)} />
        <StatTile
          label="No target"
          value={summary.noTarget.toLocaleString('en-GB')}
          hint="Answered by the load balancer itself, such as an unknown host"
          tone={summary.noTarget > 0 ? 'warning' : 'default'}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <TopList title="Top paths" items={summary.topPaths} />
        <TopList title="Top hosts" items={summary.topHosts} />
      </div>
    </div>
  );
}
