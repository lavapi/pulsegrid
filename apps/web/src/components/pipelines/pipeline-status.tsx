import type { PipelineStatus } from '@pulsegrid/shared';
import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Clock,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS: Record<
  PipelineStatus,
  {
    label: string;
    icon: LucideIcon;
    tone: 'success' | 'danger' | 'neutral' | 'primary' | 'warning';
    color: string;
  }
> = {
  running: { label: 'Running', icon: Loader2, tone: 'primary', color: 'text-primary' },
  queued: { label: 'Queued', icon: Clock, tone: 'warning', color: 'text-warning' },
  success: { label: 'Success', icon: CircleCheck, tone: 'success', color: 'text-success' },
  failure: { label: 'Failed', icon: CircleX, tone: 'danger', color: 'text-danger' },
  cancelled: { label: 'Cancelled', icon: Ban, tone: 'neutral', color: 'text-muted-foreground' },
  skipped: { label: 'Skipped', icon: CircleSlash, tone: 'neutral', color: 'text-muted-foreground' },
  unknown: { label: 'Unknown', icon: CircleDashed, tone: 'neutral', color: 'text-muted-foreground' },
};

export const pipelineStatusLabel = (status: PipelineStatus): string => STATUS[status].label;

export function PipelineStatusBadge({ status }: { status: PipelineStatus }) {
  const { label, icon: Icon, tone } = STATUS[status];
  return (
    <Badge tone={tone}>
      <Icon
        className={cn('size-3.5', status === 'running' && 'animate-spin')}
        aria-hidden="true"
      />
      {label}
    </Badge>
  );
}

export function PipelineStatusIcon({ status }: { status: PipelineStatus }) {
  const { label, icon: Icon, color } = STATUS[status];
  return (
    <Icon
      className={cn('size-4 shrink-0', color, status === 'running' && 'animate-spin')}
      aria-label={label}
      role="img"
    />
  );
}
