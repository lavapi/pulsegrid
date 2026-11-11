import { type ActionRun, type Resource, resourcePath } from '@pulsegrid/shared';
import Link from 'next/link';
import { HealthBadge } from '@/components/health-badge';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cardFacts } from '@/lib/resource-cards';
import { cn } from '@/lib/utils';
import { startedByLabel, STATUS_VIEWS } from '@/lib/action-status';
import { ActionStatusLine } from './action-status';

function ActivityStrip({ run }: { run: ActionRun }) {
  const { label, tone } = STATUS_VIEWS[run.status];
  return (
    <div className="flex flex-col gap-1.5 border-t bg-muted/40 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium">{run.title}</span>
        <Badge tone={tone} className="shrink-0">
          {label}
        </Badge>
      </div>
      <ActionStatusLine run={run} />
      <span className="truncate text-xs text-muted-foreground">{startedByLabel(run)}</span>
    </div>
  );
}

export function ResourceCard({ resource, run }: { resource: Resource; run: ActionRun | undefined }) {
  const running = run?.status === 'running';
  return (
    <Link href={resourcePath(resource)} className="group block rounded-xl focus-visible:outline-none">
      <Card
        className={cn(
          'flex h-full flex-col overflow-hidden transition-colors group-hover:border-primary/50 group-focus-visible:border-primary',
          resource.health === 'degraded' && 'border-danger/40',
          running && 'border-primary',
        )}
      >
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 break-words text-sm font-medium">{resource.name}</h3>
            <span className="shrink-0">
              <HealthBadge health={resource.health} status={resource.status} />
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            {cardFacts(resource).map(({ label, value }) => (
              <div className="min-w-0" key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="truncate text-[13px]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {run && <ActivityStrip run={run} />}
      </Card>
    </Link>
  );
}
