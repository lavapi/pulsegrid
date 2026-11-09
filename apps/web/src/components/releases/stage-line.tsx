import type { ReleaseStage, ReleaseStageStatus } from '@pulsegrid/shared';
import { Ban, CircleCheck, CircleDashed, CircleX, Loader2, type LucideIcon } from 'lucide-react';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

const STAGE_VIEWS: Record<ReleaseStageStatus, { icon: LucideIcon; style: string; label: string }> = {
  waiting: { icon: CircleDashed, style: 'bg-muted text-muted-foreground', label: 'Waiting' },
  running: { icon: Loader2, style: 'bg-primary/10 text-primary', label: 'Running' },
  success: { icon: CircleCheck, style: 'bg-success/10 text-success', label: 'Done' },
  failure: { icon: CircleX, style: 'bg-danger/10 text-danger', label: 'Failed' },
  cancelled: { icon: Ban, style: 'bg-muted text-muted-foreground', label: 'Cancelled' },
};

const stageDetail = ({ detail, durationSeconds, status }: ReleaseStage): string =>
  detail ?? (durationSeconds !== null ? formatDuration(durationSeconds) : STAGE_VIEWS[status].label);

export function StageLine({ stages }: { stages: ReleaseStage[] }) {
  return (
    <ol
      className="grid grid-cols-2 gap-1.5 sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none"
      aria-label="Release progress"
    >
      {stages.map((stage) => {
        const { icon: Icon, style } = STAGE_VIEWS[stage.status];
        return (
          <li className={cn('min-w-0 rounded-lg px-3 py-2', style)} key={stage.label}>
            <span className="flex items-center gap-1.5 text-[13px] font-medium">
              <Icon
                className={cn('size-3.5 shrink-0', stage.status === 'running' && 'animate-spin')}
                aria-hidden="true"
              />
              <span className="truncate">{stage.label}</span>
            </span>
            <span className="mt-0.5 block truncate text-xs">{stageDetail(stage)}</span>
          </li>
        );
      })}
    </ol>
  );
}
