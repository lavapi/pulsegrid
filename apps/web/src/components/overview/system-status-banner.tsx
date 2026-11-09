import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { RelativeTime } from '@/components/pipelines/relative-time';
import type { SystemStatus, SystemTone } from '@/lib/system-health';
import { cn } from '@/lib/utils';

const TONES: Record<SystemTone, { className: string; icon: typeof CircleCheck }> = {
  success: { className: 'border-success/30 bg-success-soft text-success', icon: CircleCheck },
  warning: { className: 'border-warning/30 bg-warning-soft text-warning', icon: TriangleAlert },
  danger: { className: 'border-danger/30 bg-danger-soft text-danger', icon: CircleAlert },
};

export function SystemStatusBanner({
  status: { tone, title, detail },
  lastSyncedAt,
}: {
  status: SystemStatus;
  lastSyncedAt: string | null;
}) {
  const { className, icon: Icon } = TONES[tone];
  return (
    <section className={cn('flex items-center gap-3 rounded-xl border px-5 py-4', className)} role="status">
      <Icon className="size-6 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold">{title}</p>
        {detail && <p className="mt-0.5 text-[13px]">{detail}</p>}
      </div>
      {lastSyncedAt && (
        <p className="hidden shrink-0 text-[13px] sm:block">
          Checked <RelativeTime value={lastSyncedAt} />
        </p>
      )}
    </section>
  );
}
