import type { PipelineAppSummary } from '@pulsegrid/shared';
import { Boxes } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { appPath } from '@/lib/pipelines';
import { DeploymentTimeSummary } from './deployment-times';

const pluralize = (count: number): string => `${count} ${count === 1 ? 'pipeline' : 'pipelines'}`;

function AppHealth({ running, failed }: Pick<PipelineAppSummary, 'running' | 'failed'>) {
  if (running > 0) {
    return <Badge tone="warning">{running} running</Badge>;
  }
  return failed > 0 ? <Badge tone="danger">{failed} failed</Badge> : <Badge tone="success">Healthy</Badge>;
}

export function AppCard({ app }: { app: PipelineAppSummary }) {
  return (
    <Link
      href={appPath(app.id)}
      className="flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-muted/40"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-muted text-muted-foreground">
          <Boxes className="size-5" aria-hidden="true" />
        </span>
        {!app.connectionId && <Badge tone="warning">Needs a connection</Badge>}
        {app.pipelines > 0 && <AppHealth running={app.running} failed={app.failed} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-base font-semibold">{app.name}</span>
        <span className="block truncate text-[13px] text-muted-foreground">{app.repository}</span>
      </span>
      <span className="text-[13px] text-muted-foreground">{pluralize(app.pipelines)}</span>
      {app.deployments.length > 0 && <DeploymentTimeSummary times={app.deployments} />}
    </Link>
  );
}
