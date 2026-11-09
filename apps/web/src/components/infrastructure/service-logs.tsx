'use client';

import { formatJsonText, isJsonText, LOG_RANGES, type LogLine, type LogView } from '@pulsegrid/shared';
import { Radio } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Time } from '@/components/ui/time';
import { apiSendForJson } from '@/lib/browser-api';
import { lineSeverity, mergeLines } from '@/lib/log-lines';
import { cn } from '@/lib/utils';

const LIVE_INTERVAL_MS = 5000;
const MS_PER_MINUTE = 60_000;
const SEVERITY_STYLES = { error: 'text-danger', warning: 'text-warning', normal: '' } as const;

function Line({ line }: { line: LogLine }) {
  const [open, setOpen] = useState(false);
  const expandable = isJsonText(line.message);
  return (
    <li className="px-5 py-1 font-mono text-xs">
      <span className="mr-3 whitespace-nowrap text-muted-foreground"><Time value={line.timestamp} /></span>
      {expandable ? (
        <button type="button" className="text-left" onClick={() => setOpen(!open)}>
          {open ? 'Hide JSON' : line.message}
        </button>
      ) : (
        <span className={cn('break-all', SEVERITY_STYLES[lineSeverity(line.message)])}>{line.message}</span>
      )}
      {open && (
        <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-3">{formatJsonText(line.message)}</pre>
      )}
    </li>
  );
}

export function ServiceLogs({ resourceId }: { resourceId: string }) {
  const [range, setRange] = useState<(typeof LOG_RANGES)[number]>(LOG_RANGES[0]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [live, setLive] = useState(false);
  const [view, setView] = useState<LogView | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const opened = useRef(false);
  const latest = useRef<string | null>(null);

  const load = useCallback(
    async (since: Date, append: boolean) => {
      const query = new URLSearchParams({
        since: since.toISOString(),
        opened: String(!opened.current),
        ...(applied ? { search: applied } : {}),
      });
      opened.current = true;
      const { data, error } = await apiSendForJson<LogView>(`/resources/${resourceId}/logs?${query}`, 'GET');
      setFailure(error);
      if (!data) {
        return;
      }
      latest.current = data.lines.at(-1)?.timestamp ?? latest.current;
      setView((current) =>
        append && current ? { ...data, lines: mergeLines(current.lines, data.lines) } : data,
      );
    },
    [applied, resourceId],
  );

  useEffect(() => {
    latest.current = null;
    void load(new Date(Date.now() - range.minutes * MS_PER_MINUTE), false);
  }, [load, range]);

  useEffect(() => {
    if (!live) {
      return;
    }
    const timer = setInterval(() => {
      const since = latest.current ? new Date(latest.current) : new Date(Date.now() - MS_PER_MINUTE);
      if (document.visibilityState === 'visible') {
        void load(since, true);
      }
    }, LIVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [live, load]);

  const denied = view && !view.access.allowed;

  return (
    <Card>
      <CardHeader title="Logs" description="From CloudWatch. Lines are never stored here." />
      {denied ? (
        <p className="p-5 text-sm text-muted-foreground">{view.access.reason}</p>
      ) : (
        <>
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
            <form
              className="min-w-40 flex-1"
              onSubmit={(event) => {
                event.preventDefault();
                setApplied(search.trim());
              }}
            >
              <Input
                aria-label="Search logs"
                placeholder="Search, then press Enter"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </form>
            <Button
              size="sm"
              variant={live ? 'primary' : 'secondary'}
              aria-pressed={live}
              onClick={() => setLive(!live)}
            >
              <Radio />
              Live
            </Button>
          </div>
          {(failure ?? view?.error) && <p className="px-5 py-3 text-sm text-danger">{failure ?? view?.error}</p>}
          {view && !view.available && (
            <p className="p-5 text-sm text-muted-foreground">
              This service doesn't send logs to CloudWatch.
            </p>
          )}
          {view?.available && !view.error && view.lines.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">No log lines in this time range.</p>
          )}
          {view && view.lines.length > 0 && (
            <ol className="max-h-[32rem] overflow-y-auto py-2">
              {view.lines.map((line) => (
                <Line key={line.id} line={line} />
              ))}
            </ol>
          )}
        </>
      )}
    </Card>
  );
}
