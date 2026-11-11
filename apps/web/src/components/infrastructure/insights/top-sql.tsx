'use client';

import { type InstanceTopSql, QUERY_ACTIVITY_RANGES, type TopSqlView } from '@pulsegrid/shared';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiSendForJson } from '@/lib/browser-api';
import { formatMs, formatShare } from '@/lib/resource-logs';
import { LogProblemNotice } from './log-problem';

type Range = (typeof QUERY_ACTIVITY_RANGES)[number];

function Statement({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className={open ? 'whitespace-pre-wrap break-all text-left' : 'line-clamp-2 break-all text-left'}
      onClick={() => setOpen(!open)}
      title={open ? 'Show less' : 'Show the whole statement'}
    >
      {text}
    </button>
  );
}

function InstanceStatements({ instance }: { instance: InstanceTopSql }) {
  return (
    <Card>
      <CardHeader
        title={instance.instance}
        description={instance.load === null ? undefined : `${instance.load} average active sessions over the range`}
      />
      {instance.unavailable ? (
        <p className="p-5 text-[13px] text-muted-foreground">{instance.unavailable}</p>
      ) : instance.statements.length === 0 ? (
        <p className="p-5 text-[13px] text-muted-foreground">No statements ran in this range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[12px] text-faint">
              <tr>
                {['Statement', 'Load (AAS)', 'Share of load', 'Top waits', 'Calls/s', 'Avg latency'].map((title) => (
                  <th key={title} className="whitespace-nowrap px-3 py-2 font-semibold first:pl-5 last:pr-5">
                    {title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {instance.statements.map((statement) => (
                <tr key={statement.id} className="border-t align-top">
                  <td className="max-w-xl py-2 pl-5 pr-3 font-mono text-xs">
                    <Statement text={statement.statement} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{statement.load}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <span className="block h-full bg-primary" style={{ width: `${statement.share * 100}%` }} />
                      </span>
                      <span className="tabular-nums">{formatShare(statement.share)}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {statement.waits.length === 0
                      ? '—'
                      : statement.waits.map(({ name, load }) => (
                          <div key={name} className="whitespace-nowrap">
                            {name} <span className="tabular-nums">{load}</span>
                          </div>
                        ))}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{statement.callsPerSecond ?? '—'}</td>
                  <td className="py-2 pl-3 pr-5 tabular-nums">{formatMs(statement.avgLatencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The busiest statements of each instance, from Performance Insights. */
export function TopSql({ resourceId }: { resourceId: string }) {
  const [range, setRange] = useState<Range>(QUERY_ACTIVITY_RANGES[0]);
  const [view, setView] = useState<TopSqlView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    setView(null);
    void apiSendForJson<TopSqlView>(`/resources/${resourceId}/top-sql?range=${range.id}`, 'GET').then(
      ({ data, error }) => {
        setView(data);
        setFailure(error);
      },
    );
  }, [resourceId, range]);

  return (
    <section className="flex flex-col gap-3" aria-label="Top SQL">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Top SQL</h2>
          <p className="text-[13px] text-muted-foreground">
            From Performance Insights. Statements show placeholders instead of values.
          </p>
        </div>
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="Time range">
          {QUERY_ACTIVITY_RANGES.map((item) => (
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
      </div>
      {failure && <p className="text-sm text-danger">{failure}</p>}
      {!view && !failure && <Skeleton className="h-40 rounded-xl" />}
      {view && !view.access.allowed && <p className="text-sm text-muted-foreground">{view.access.reason}</p>}
      {view?.problem && (
        <Card>
          <LogProblemNotice problem={view.problem} />
        </Card>
      )}
      {view?.instances.map((instance) => (
        <InstanceStatements key={instance.instance} instance={instance} />
      ))}
    </section>
  );
}
