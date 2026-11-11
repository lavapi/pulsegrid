'use client';

import type { ActionRun } from '@pulsegrid/shared';
import { useEffect, useState } from 'react';
import { STATUS_VIEWS } from '@/lib/action-status';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

const TICK_MS = 1000;

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
