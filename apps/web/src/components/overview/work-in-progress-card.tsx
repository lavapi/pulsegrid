import { type ActionRun, type Resource, resourcePath } from '@pulsegrid/shared';
import Link from 'next/link';
import { startedByLabel, STATUS_VIEWS } from '@/components/infrastructure/action-status';
import { RelativeTime } from '@/components/pipelines/relative-time';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';

export interface WorkInProgress {
  run: ActionRun;
  resource: Resource;
}

export function WorkInProgressCard({ items }: { items: WorkInProgress[] }) {
  return (
    <Card>
      <CardHeader title="Work in progress" description="Deployments, reboots and changes happening now" />
      <ul className="divide-y">
        {items.map(({ run, resource }) => (
          <li key={run.id}>
            <Link
              href={resourcePath(resource)}
              className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-muted"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">
                  {run.title}: {resource.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {startedByLabel(run)} · <RelativeTime value={run.startedAt} />
                </span>
              </span>
              <Badge tone={STATUS_VIEWS[run.status].tone}>{run.summary}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
