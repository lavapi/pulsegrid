'use client';

import type { ActionRun, ActionRunStatus } from '@pulsegrid/shared';
import { CircleAlert, CircleCheck, CircleX, LoaderCircle, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

const TICK_MS = 1000;

export const STATUS_VIEWS: Record<
  ActionRunStatus,
  { label: string; tone: 'primary' | 'success' | 'danger' | 'warning'; icon: LucideIcon; color: string }
> = {
  running: { label: 'In progress', tone: 'primary', icon: LoaderCircle, color: 'animate-spin text-primary' },
  succeeded: { label: 'Finished', tone: 'success', icon: CircleCheck, color: 'text-success' },
  failed: { label: 'Failed', tone: 'danger', icon: CircleX, color: 'text-danger' },
  timed_out: { label: 'Timed out', tone: 'warning', icon: CircleAlert, color: 'text-warning' },
  unconfirmed: { label: 'Not confirmed', tone: 'warning', icon: CircleAlert, color: 'text-warning' },
};

export const startedByLabel = ({ startedBy }: ActionRun): string =>
  startedBy ? `Started by ${startedBy}` : 'Started outside the dashboard';

const secondsBetween = (start: string, end: number): number =>
  Math.max(0, Math.round((end - new Date(start).getTime()) / TICK_MS));

export function ActionStatusLine({ run, className }: { run: ActionRun; className?: string }) {
  const { icon: Icon, color } = STATUS_VIEWS[run.status];
  const [now, setNow] = useState<number | null>(null);
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : now;

  useEffect(() => {
    setNow(Date.now());
    if (run.status !== 'running') {
      return undefined;
    }
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [run.status]);

  return (
    <div className={cn('flex items-center gap-2.5 text-[13px]', className)} role="status">
      <Icon className={cn('size-4 shrink-0', color)} aria-hidden="true" />
      <span className="min-w-0 flex-1">{run.summary}</span>
      {end !== null && (
        <span className="shrink-0 text-muted-foreground">{formatDuration(secondsBetween(run.startedAt, end))}</span>
      )}
    </div>
  );
}
