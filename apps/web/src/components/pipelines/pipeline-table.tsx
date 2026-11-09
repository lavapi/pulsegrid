'use client';

import type { PipelineSummary } from '@pulsegrid/shared';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Dropdown } from '@/components/ui/dropdown';
import { Input } from '@/components/ui/input';
import { formatDuration } from '@/lib/format';
import { pipelinePath, runPath } from '@/lib/pipelines';
import { PipelineStatusBadge } from './pipeline-status';
import { RelativeTime } from './relative-time';

const FILTER_THRESHOLD = 6;
const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'queued', label: 'Queued' },
  { value: 'failure', label: 'Failed' },
  { value: 'success', label: 'Success' },
];

const matches = (pipeline: PipelineSummary, query: string, status: string): boolean => {
  const text = `${pipeline.name} ${pipeline.repository} ${pipeline.latestRun?.branch ?? ''}`;
  return (
    text.toLowerCase().includes(query.toLowerCase()) &&
    (!status || pipeline.latestRun?.status === status)
  );
};

export function PipelineTable({
  pipelines,
  showRepository = true,
}: {
  pipelines: PipelineSummary[];
  showRepository?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const visible = useMemo(
    () => pipelines.filter((pipeline) => matches(pipeline, query, status)),
    [pipelines, query, status],
  );

  return (
    <>
      {pipelines.length >= FILTER_THRESHOLD && (
        <div className="flex flex-wrap gap-2.5 border-b p-3">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search
              className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by name, repository or branch"
              aria-label="Filter pipelines"
              className="pl-9"
            />
          </div>
          <Dropdown
            label="Status"
            value={status}
            onValueChange={setStatus}
            options={STATUS_FILTERS}
            className="w-40"
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Pipeline</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Latest run</th>
              <th className="px-4 py-2.5 font-medium">By</th>
              <th className="px-4 py-2.5 font-medium">Started</th>
              <th className="px-4 py-2.5 font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((pipeline) => {
              const run = pipeline.latestRun;
              return (
                <tr
                  className="border-b transition-colors last:border-0 hover:bg-muted/60"
                  key={`${pipeline.repository}-${pipeline.workflowId}`}
                >
                  <td className="px-4 py-3">
                    <Link
                      href={pipelinePath(pipeline.appId, pipeline.workflowId)}
                      className="font-medium hover:text-primary"
                    >
                      {pipeline.name}
                    </Link>
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {showRepository && pipeline.repository}
                      {pipeline.environmentName ? (
                        <Badge tone={pipeline.production ? 'danger' : 'neutral'}>
                          {pipeline.environmentName}
                        </Badge>
                      ) : (
                        <Badge tone="neutral">Shared</Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {run ? <PipelineStatusBadge status={run.status} /> : '—'}
                  </td>
                  <td className="max-w-[300px] px-4 py-3">
                    {run ? (
                      <>
                        <Link
                          href={runPath(pipeline.appId, run.id)}
                          className="block truncate hover:text-primary"
                        >
                          {run.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {run.branch} · {run.commit}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Hasn&apos;t run yet</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {run?.actor ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    <RelativeTime value={run?.startedAt ?? null} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatDuration(run?.durationSeconds ?? null)}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No pipelines match these filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
