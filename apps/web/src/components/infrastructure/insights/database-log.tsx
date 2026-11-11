'use client';

import { DATABASE_LOG_LEVELS, type DatabaseLogLevel, type DatabaseLogView, LOG_RANGES } from '@pulsegrid/shared';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Time } from '@/components/ui/time';
import { apiSendForJson } from '@/lib/browser-api';
import { formatMs } from '@/lib/resource-logs';
import { cn } from '@/lib/utils';
import { LogProblemNotice } from './log-problem';

const MS_PER_MINUTE = 60_000;
const SEVERITY_STYLES: Record<string, string> = {
  ERROR: 'text-danger',
  FATAL: 'text-danger',
  PANIC: 'text-danger',
  WARNING: 'text-warning',
};

type Range = (typeof LOG_RANGES)[number];

function SlowQueries({ view }: { view: DatabaseLogView }) {
  return (
    <Card>
      <CardHeader
        title="Slow queries"
        description="Statements PostgreSQL logged because they took longer than log_min_duration_statement."
      />
      {view.slowQueries.length === 0 ? (
        <p className="p-5 text-[13px] text-muted-foreground">
          None in this range. They appear here once log_min_duration_statement is set in the database's parameter group.
        </p>
      ) : (
        <ol className="divide-y">
          {view.slowQueries.map((query) => (
            <li key={query.id} className="flex flex-col gap-1 px-5 py-2 text-[13px]">
              <span className="flex flex-wrap gap-3 text-muted-foreground">
                <Time value={query.time} seconds />
                <strong className="tabular-nums text-foreground">{formatMs(query.durationMs)}</strong>
                <span>{query.instance}</span>
              </span>
              <code className="whitespace-pre-wrap break-all font-mono text-xs">{query.statement}</code>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** The PostgreSQL log from CloudWatch Logs, problems first, and the slow queries in it. */
export function DatabaseLog({ resourceId }: { resourceId: string }) {
  const [range, setRange] = useState<Range>(LOG_RANGES[1]);
  const [level, setLevel] = useState<DatabaseLogLevel>('problems');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [view, setView] = useState<DatabaseLogView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setView(null);
    const query = new URLSearchParams({
      since: new Date(Date.now() - range.minutes * MS_PER_MINUTE).toISOString(),
      level,
      ...(applied ? { search: applied } : {}),
    });
    void apiSendForJson<DatabaseLogView>(`/resources/${resourceId}/database-log?${query}`, 'GET').then(
      ({ data, error }) => {
        setView(data);
        setFailure(error);
      },
    );
  }, [resourceId, range, level, applied, tick]);

  if (view && !view.access.allowed) {
    return <p className="text-sm text-muted-foreground">{view.access.reason}</p>;
  }

  return (
    <section className="flex flex-col gap-3" aria-label="PostgreSQL log">
      <Card>
        <CardHeader
          title="PostgreSQL log"
          description={`From CloudWatch Logs, newest first, never stored.${view && !view.showsValues ? ' Values in statements and key details are hidden.' : ''}`}
        />
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Time range">
            {LOG_RANGES.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={range.id === item.id ? 'secondary' : 'ghost'}
                aria-pressed={range.id === item.id}
                onClick={() => setRange(item)}
              >
                {item.id}
              </Button>
            ))}
          </div>
          <select
            aria-label="Severity"
            className="h-9 rounded-lg border bg-card px-2 text-sm"
            value={level}
            onChange={(event) => setLevel(event.target.value as DatabaseLogLevel)}
          >
            {DATABASE_LOG_LEVELS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <form
            className="min-w-40 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              setApplied(search.trim());
            }}
          >
            <Input
              aria-label="Search the log"
              placeholder="Search, then press Enter"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </form>
          <Button size="sm" variant="ghost" onClick={() => setTick(tick + 1)}>
            Refresh
          </Button>
        </div>
        {failure && <p className="px-5 py-3 text-sm text-danger">{failure}</p>}
        {view?.problem && <LogProblemNotice problem={view.problem} />}
        {!view && !failure && <p className="p-5 text-sm text-muted-foreground">Reading the log…</p>}
        {view && !view.problem && view.lines.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">Nothing matches in this time range.</p>
        )}
        {view?.partial && (
          <p className="px-5 pt-3 text-[13px] text-muted-foreground">
            Showing the newest 500 lines. Choose a shorter range or a severity to see older ones.
          </p>
        )}
        {view && view.lines.length > 0 && (
          <ol className="max-h-[32rem] overflow-y-auto py-2">
            {view.lines.map((line) => (
              <li key={line.id} className="px-5 py-1 font-mono text-xs">
                <span className="mr-3 whitespace-nowrap text-muted-foreground">
                  <Time value={line.time} seconds />
                </span>
                <span className="mr-3 text-muted-foreground">{line.instance}</span>
                <span className={cn('mr-2 font-semibold', SEVERITY_STYLES[line.severity])}>{line.severity}</span>
                <span className="break-all">{line.message}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      {view && !view.problem && <SlowQueries view={view} />}
    </section>
  );
}
