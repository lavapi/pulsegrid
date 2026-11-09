import type { PipelineActivityItem } from '@pulsegrid/shared';
import Link from 'next/link';
import { PipelineStatusBadge } from '@/components/pipelines/pipeline-status';
import { RelativeTime } from '@/components/pipelines/relative-time';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';

function ActivityRow({ item: { appId, appName, name, environmentName, run } }: { item: PipelineActivityItem }) {
  return (
    <li>
      <Link
        href={`/pipelines/apps/${appId}/runs/${run.id}`}
        className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-muted"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">
            {appName}: {name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {run.branch}
            {run.actor ? ` · ${run.actor}` : ''} · <RelativeTime value={run.startedAt} />
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {environmentName && <Badge>{environmentName}</Badge>}
          <PipelineStatusBadge status={run.status} />
        </span>
      </Link>
    </li>
  );
}

export function PipelineActivityCard({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: PipelineActivityItem[];
}) {
  return (
    <Card>
      <CardHeader title={title} />
      {items.length > 0 ? (
        <ul className="divide-y">
          {items.map((item) => (
            <ActivityRow key={`${item.appId}:${item.run.id}`} item={item} />
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-[13px] text-muted-foreground">{empty}</p>
      )}
    </Card>
  );
}
