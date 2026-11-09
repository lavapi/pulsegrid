import {
  isActivePipelineStatus,
  type PipelineJob,
  type PipelineRunDetail,
} from '@pulsegrid/shared';
import { ArrowLeft, ExternalLink, Info } from 'lucide-react';
import Link from 'next/link';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import {
  PipelineStatusBadge,
  PipelineStatusIcon,
} from '@/components/pipelines/pipeline-status';
import { RelativeTime } from '@/components/pipelines/relative-time';
import { RunActions } from '@/components/pipelines/run-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { formatDuration } from '@/lib/format';
import { pipelinePath } from '@/lib/pipelines';
import { apiGet } from '@/lib/server-api';

function JobCard({ job }: { job: PipelineJob }) {
  const finishedSteps = job.steps.filter(({ status }) => !isActivePipelineStatus(status)).length;
  return (
    <Card>
      <CardHeader
        title={job.name}
        description={`${finishedSteps} of ${job.steps.length} steps · ${formatDuration(job.durationSeconds)}`}
        action={
          <div className="flex items-center gap-2">
            <PipelineStatusBadge status={job.status} />
            <Button asChild size="sm" variant="ghost">
              <a href={job.url} target="_blank" rel="noopener noreferrer">
                Logs
                <ExternalLink />
              </a>
            </Button>
          </div>
        }
      />
      <ol className="divide-y">
        {job.steps.map((step) => (
          <li className="flex items-center gap-3 px-5 py-2.5 text-[13px]" key={step.number}>
            <PipelineStatusIcon status={step.status} />
            <span className="min-w-0 flex-1 truncate">{step.name}</span>
            <span className="text-muted-foreground">{formatDuration(step.durationSeconds)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export default async function PipelineRunPage({
  params,
}: {
  params: Promise<{ id: string; runId: string }>;
}) {
  const { id, runId } = await params;
  const query = new URLSearchParams({ app: id, run: runId });
  const { app, rerunsFailedJobs, run, jobs, access, environmentName } = await apiGet<PipelineRunDetail>(
    `/pipelines/run?${query}`,
  );
  const active = isActivePipelineStatus(run.status);

  return (
    <>
      <LiveRefresh active={active} />
      <Link
        href={pipelinePath(app.id, run.workflowId)}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {run.workflowName}
      </Link>
      <PageHeader
        title={run.title}
        description={`${run.repository} · Run #${run.number}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {environmentName && (
              <Badge tone={access.production ? 'danger' : 'neutral'}>{environmentName}</Badge>
            )}
            <PipelineStatusBadge status={run.status} />
            {access.canAct && (
              <RunActions
                appId={app.id}
                run={run}
                rerunsFailedJobs={rerunsFailedJobs}
              />
            )}
            <Button asChild>
              <a href={run.url} target="_blank" rel="noopener noreferrer">
                Open run
                <ExternalLink />
              </a>
            </Button>
          </div>
        }
      />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Run summary">
        <StatTile label="Branch" value={run.branch || '—'} compact />
        <StatTile label="Commit" value={run.commit} compact />
        <StatTile label="Triggered by" value={run.actor ?? run.event} compact />
        <StatTile label="Duration" value={formatDuration(run.durationSeconds)} compact />
      </section>
      {access.reason && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          {access.reason}
        </p>
      )}
      <p className="text-[13px] text-muted-foreground">
        Started <RelativeTime value={run.startedAt} /> by a {run.event} event.
        {active && ' Progress updates every few seconds. Full logs appear with your Git provider when each job finishes.'}
      </p>
      {jobs.map((job) => (
        <JobCard job={job} key={job.id} />
      ))}
    </>
  );
}
