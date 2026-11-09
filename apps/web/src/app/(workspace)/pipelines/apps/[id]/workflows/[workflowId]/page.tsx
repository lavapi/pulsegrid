import {
  type EnvironmentSummary,
  isActivePipelineStatus,
  type PipelineHistory,
  hasPermission,
} from '@pulsegrid/shared';
import { ArrowLeft, ExternalLink, Info } from 'lucide-react';
import Link from 'next/link';
import { EnvironmentLink } from '@/components/pipelines/environment-link';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { PipelineStatusBadge } from '@/components/pipelines/pipeline-status';
import { RunPipelineButton } from '@/components/pipelines/run-pipeline-button';
import { RelativeTime } from '@/components/pipelines/relative-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { getAccountContext } from '@/lib/account-context';
import { pipelineScope } from '@/lib/account-selection';
import { formatDuration } from '@/lib/format';
import { appPath, runPath } from '@/lib/pipelines';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function PipelineHistoryPage({
  params,
}: {
  params: Promise<{ id: string; workflowId: string }>;
}) {
  const { id, workflowId } = await params;
  const { selected } = await getAccountContext();
  const query = new URLSearchParams({
    app: id,
    workflow: workflowId,
    ...pipelineScope(selected),
  });
  const [{ app, pipeline, runs, options }, user] = await Promise.all([
    apiGet<PipelineHistory>(`/pipelines/history?${query}`),
    getCurrentUser(),
  ]);
  const canLink = hasPermission(user, 'pipeline_apps.manage');
  const rule = options.definition.environmentRule;
  const environments = canLink ? await apiGet<EnvironmentSummary[]>('/environments') : [];

  return (
    <>
      <LiveRefresh active={runs.some(({ status }) => isActivePipelineStatus(status))} />
      <Link
        href={appPath(app.id)}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {app.name}
      </Link>
      <PageHeader
        title={pipeline.name}
        description={`${pipeline.repository} · ${pipeline.path}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {options.access.production && <Badge tone="danger">Production</Badge>}
            {options.access.canAct && options.definition.manual && (
              <RunPipelineButton
                appId={app.id}
                repository={pipeline.repository}
                workflowId={pipeline.workflowId}
                name={pipeline.name}
                options={options}
              />
            )}
            {canLink && !pipeline.branchRouted && (
              <EnvironmentLink
                appId={app.id}
                workflowId={pipeline.workflowId}
                environmentId={pipeline.environmentId}
                environments={environments}
              />
            )}
            <Button asChild>
              <a href={pipeline.url} target="_blank" rel="noopener noreferrer">
                Open repository
                <ExternalLink />
              </a>
            </Button>
          </div>
        }
      />
      {rule && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          Runs on {rule.branch} use {rule.matched}. Runs on other branches use {rule.otherwise}.
        </p>
      )}
      {(!options.access.canAct || !options.definition.manual) && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Info className="size-4 shrink-0" aria-hidden="true" />
          {options.access.reason ??
            "This pipeline can't be started from here. Its workflow needs a manual trigger."}
        </p>
      )}
      <Card>
        <CardHeader title={`Recent runs (${runs.length})`} />
        <div className="overflow-x-auto">
          <table className="min-w-full text-[13px]">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Run</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Branch</th>
                <th className="px-4 py-2.5 font-medium">By</th>
                <th className="px-4 py-2.5 font-medium">Started</th>
                <th className="px-4 py-2.5 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr className="border-b last:border-0 hover:bg-muted/60" key={run.id}>
                  <td className="max-w-[360px] px-4 py-3">
                    <Link
                      href={runPath(app.id, run.id)}
                      className="block truncate font-medium hover:text-primary"
                    >
                      {run.title}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      #{run.number} · {run.commit} · {run.event}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <PipelineStatusBadge status={run.status} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{run.branch}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {run.actor ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    <RelativeTime value={run.startedAt} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatDuration(run.durationSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
