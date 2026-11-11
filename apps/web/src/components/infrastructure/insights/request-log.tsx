'use client';

import {
  type ConnectionLogPage,
  LOG_RANGES,
  type RequestLogFilter,
  type RequestLogPage,
  type RequestLogSummary,
  STATUS_CLASSES,
} from '@pulsegrid/shared';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Time } from '@/components/ui/time';
import { apiSendForJson } from '@/lib/browser-api';
import { formatMs, requestLogQuery, statusTone } from '@/lib/resource-logs';
import { LogProblemNotice } from './log-problem';
import { RequestSummary } from './request-summary';

const MS_PER_MINUTE = 60_000;
const CLOUDFLARE_NOTE = "Cloudflare's edge, not the visitor";

type Range = (typeof LOG_RANGES)[number];
type View = 'requests' | 'connections';

interface Filters {
  host: string;
  path: string;
  status: string;
  service: string;
  minResponseMs: string;
  userAgent: string;
}

const NO_FILTERS: Filters = { host: '', path: '', status: '', service: '', minResponseMs: '', userAgent: '' };

const toFilter = (range: Range, filters: Filters, showQuery: boolean): RequestLogFilter => {
  const to = new Date();
  return {
    from: new Date(to.getTime() - range.minutes * MS_PER_MINUTE).toISOString(),
    to: to.toISOString(),
    host: filters.host.trim() || undefined,
    path: filters.path.trim() || undefined,
    status: filters.status || undefined,
    service: filters.service.trim() || undefined,
    minResponseMs: filters.minResponseMs ? Number(filters.minResponseMs) : undefined,
    userAgent: filters.userAgent.trim() || undefined,
    showQuery: showQuery || undefined,
  };
};

function StatusBadge({ status }: { status: number | null }) {
  return <Badge tone={statusTone(status)}>{status ?? '—'}</Badge>;
}

function RangePicker({ range, onChange }: { range: Range; onChange: (range: Range) => void }) {
  return (
    <div className="flex rounded-lg border p-0.5" role="group" aria-label="Time range">
      {LOG_RANGES.map((item) => (
        <Button
          key={item.id}
          size="sm"
          variant={range.id === item.id ? 'secondary' : 'ghost'}
          aria-pressed={range.id === item.id}
          onClick={() => onChange(item)}
        >
          {item.id}
        </Button>
      ))}
    </div>
  );
}

function RequestTable({ page }: { page: RequestLogPage }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="text-left text-[12px] text-faint">
          <tr>
            {[
              'Time',
              'Host',
              'Request',
              'ELB',
              'Target',
              'Response',
              'Service',
              'User agent',
              'Cloudflare edge IP',
            ].map((title) => (
              <th key={title} className="whitespace-nowrap px-3 py-2 font-semibold first:pl-5 last:pr-5">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.entries.map((entry, index) => (
            <tr key={`${entry.time}-${index}`} className="border-t align-top">
              <td className="whitespace-nowrap py-2 pl-5 pr-3 text-muted-foreground">
                <Time value={entry.time} seconds />
              </td>
              <td className="max-w-48 truncate px-3 py-2" title={entry.host}>
                {entry.host || '—'}
              </td>
              <td className="min-w-64 max-w-md px-3 py-2 font-mono text-xs">
                <span className="mr-1.5 text-muted-foreground">{entry.method}</span>
                <span className="[overflow-wrap:anywhere]">{entry.path}</span>
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={entry.elbStatus} />
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={entry.targetStatus} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatMs(entry.responseMs)}</td>
              <td className="whitespace-nowrap px-3 py-2">
                {entry.service ?? <span className="text-muted-foreground">No target</span>}
              </td>
              <td className="max-w-56 truncate px-3 py-2 text-muted-foreground" title={entry.userAgent}>
                {entry.userAgent || '—'}
              </td>
              <td className="whitespace-nowrap py-2 pl-3 pr-5 font-mono text-xs">{entry.edgeIp}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectionTable({ page }: { page: ConnectionLogPage }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="text-left text-[12px] text-faint">
          <tr>
            {['Time', 'Cloudflare edge IP', 'Port', 'TLS', 'Cipher', 'Handshake', 'Result'].map((title) => (
              <th key={title} className="whitespace-nowrap px-3 py-2 font-semibold first:pl-5 last:pr-5">
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.entries.map((entry, index) => (
            <tr key={`${entry.time}-${index}`} className="border-t">
              <td className="whitespace-nowrap py-2 pl-5 pr-3 text-muted-foreground">
                <Time value={entry.time} seconds />
              </td>
              <td className="px-3 py-2 font-mono text-xs">{entry.edgeIp}</td>
              <td className="px-3 py-2">{entry.listenerPort ?? '—'}</td>
              <td className="px-3 py-2">{entry.tlsProtocol}</td>
              <td className="px-3 py-2 font-mono text-xs">{entry.tlsCipher}</td>
              <td className="px-3 py-2 tabular-nums">{formatMs(entry.handshakeMs)}</td>
              <td className={entry.result === 'Success' ? 'py-2 pl-3 pr-5' : 'py-2 pl-3 pr-5 text-danger'}>
                {entry.result}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FilterForm({ filters, onApply }: { filters: Filters; onApply: (filters: Filters) => void }) {
  const [draft, setDraft] = useState(filters);
  const set = (key: keyof Filters) => (event: { target: { value: string } }) =>
    setDraft({ ...draft, [key]: event.target.value });
  return (
    <form
      className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(draft);
      }}
    >
      <Input aria-label="Host" placeholder="Host" value={draft.host} onChange={set('host')} />
      <Input aria-label="Path contains" placeholder="Path contains" value={draft.path} onChange={set('path')} />
      <select
        aria-label="Status"
        className="h-9 rounded-lg border bg-card px-2 text-sm"
        value={STATUS_CLASSES.includes(draft.status as never) || !draft.status ? draft.status : 'exact'}
        onChange={(event) =>
          setDraft({ ...draft, status: event.target.value === 'exact' ? '404' : event.target.value })
        }
      >
        <option value="">Any status</option>
        {STATUS_CLASSES.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
        <option value="exact">Exact code…</option>
      </select>
      {draft.status && !STATUS_CLASSES.includes(draft.status as never) && (
        <Input aria-label="Exact status" inputMode="numeric" value={draft.status} onChange={set('status')} />
      )}
      <Input aria-label="Service" placeholder="Service" value={draft.service} onChange={set('service')} />
      <Input
        aria-label="Minimum response time in ms"
        placeholder="Min ms"
        inputMode="numeric"
        value={draft.minResponseMs}
        onChange={set('minResponseMs')}
      />
      <Input
        aria-label="User agent contains"
        placeholder="User agent"
        value={draft.userAgent}
        onChange={set('userAgent')}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary">
          Apply
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft(NO_FILTERS);
            onApply(NO_FILTERS);
          }}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

/** A load balancer's requests, read from its access logs in S3 when someone looks; never stored. */
export function RequestLog({ resourceId }: { resourceId: string }) {
  const [view, setView] = useState<View>('requests');
  const [range, setRange] = useState<Range>(LOG_RANGES[0]);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showQuery, setShowQuery] = useState(false);
  const [failedOnly, setFailedOnly] = useState(false);
  const [filter, setFilter] = useState<RequestLogFilter | null>(null);
  const [page, setPage] = useState<RequestLogPage | null>(null);
  const [summary, setSummary] = useState<RequestLogSummary | null>(null);
  const [connections, setConnections] = useState<ConnectionLogPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(() => setFilter(toFilter(range, filters, showQuery)), [range, filters, showQuery]);
  useEffect(refresh, [refresh]);

  const base = `/resources/${resourceId}`;
  const loadRequests = useCallback(
    async (before?: string) => {
      if (!filter) {
        return;
      }
      setLoading(true);
      const { data, error } = await apiSendForJson<RequestLogPage>(
        `${base}/request-log?${requestLogQuery({ ...filter, before })}`,
        'GET',
      );
      setLoading(false);
      setFailure(error);
      if (data) {
        setPage((current) => (before && current ? { ...data, entries: [...current.entries, ...data.entries] } : data));
      }
    },
    [base, filter],
  );

  const loadConnections = useCallback(
    async (before?: string) => {
      if (!filter) {
        return;
      }
      setLoading(true);
      const query = requestLogQuery({ from: filter.from, to: filter.to, before, failedOnly });
      const { data, error } = await apiSendForJson<ConnectionLogPage>(`${base}/connection-log?${query}`, 'GET');
      setLoading(false);
      setFailure(error);
      if (data) {
        setConnections((current) =>
          before && current ? { ...data, entries: [...current.entries, ...data.entries] } : data,
        );
      }
    },
    [base, filter, failedOnly],
  );

  useEffect(() => {
    if (!filter) {
      return;
    }
    if (view === 'connections') {
      setConnections(null);
      void loadConnections();
      return;
    }
    setPage(null);
    setSummary(null);
    void loadRequests();
    void apiSendForJson<RequestLogSummary>(`${base}/request-log/summary?${requestLogQuery(filter)}`, 'GET').then(
      ({ data }) => setSummary(data),
    );
  }, [base, filter, view, loadRequests, loadConnections]);

  const current = view === 'requests' ? page : connections;
  if (current && !current.access.allowed) {
    return (
      <Card>
        <p className="p-5 text-sm text-muted-foreground">{current.access.reason}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5" role="group" aria-label="Log">
          {(['requests', 'connections'] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={view === item ? 'secondary' : 'ghost'}
              aria-pressed={view === item}
              onClick={() => setView(item)}
            >
              {item === 'requests' ? 'Requests' : 'TLS connections'}
            </Button>
          ))}
        </div>
        <RangePicker range={range} onChange={setRange} />
        <Button size="sm" variant="ghost" onClick={refresh}>
          Refresh
        </Button>
        {view === 'requests' && page?.canShowQuery && (
          <label className="ml-auto flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={showQuery} onChange={(event) => setShowQuery(event.target.checked)} />
            Show query strings
          </label>
        )}
        {view === 'connections' && (
          <label className="ml-auto flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={failedOnly} onChange={(event) => setFailedOnly(event.target.checked)} />
            Failed handshakes only
          </label>
        )}
      </div>
      {view === 'requests' && !page?.problem && <RequestSummary summary={summary} />}
      <Card>
        <CardHeader
          title={view === 'requests' ? 'Requests' : 'TLS connections'}
          description={`Newest first, read from the load balancer's logs in S3 and never stored. Client addresses are ${CLOUDFLARE_NOTE}. Files arrive every 5 minutes, so the last few minutes may be missing.`}
        />
        {view === 'requests' && (
          <div className="border-b px-5 py-3">
            <FilterForm filters={filters} onApply={setFilters} />
          </div>
        )}
        {failure && <p className="px-5 py-3 text-sm text-danger">{failure}</p>}
        {current?.problem && <LogProblemNotice problem={current.problem} />}
        {!current && <p className="p-5 text-sm text-muted-foreground">Reading the logs…</p>}
        {current && !current.problem && current.entries.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">Nothing matches in this time range.</p>
        )}
        {view === 'requests' && page && page.entries.length > 0 && <RequestTable page={page} />}
        {view === 'connections' && connections && connections.entries.length > 0 && (
          <ConnectionTable page={connections} />
        )}
        {current?.older && (
          <div className="border-t px-5 py-3">
            <Button
              size="sm"
              disabled={loading}
              onClick={() =>
                void (view === 'requests'
                  ? loadRequests(current.older ?? undefined)
                  : loadConnections(current.older ?? undefined))
              }
            >
              {loading ? 'Reading…' : 'Older'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
