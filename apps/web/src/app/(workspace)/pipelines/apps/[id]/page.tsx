import {
  isActivePipelineStatus,
  type PipelineAppDetail,
  hasPermission,
} from '@pulsegrid/shared';
import { ArrowLeft, GitBranch } from 'lucide-react';
import Link from 'next/link';
import { DeleteAppButton } from '@/components/pipelines/delete-app-button';
import { DeploymentTimeTiles } from '@/components/pipelines/deployment-times';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { PipelineIssues } from '@/components/pipelines/pipeline-issues';
import { PipelineTable } from '@/components/pipelines/pipeline-table';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { getAccountContext } from '@/lib/account-context';
import { pipelineScope } from '@/lib/account-selection';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function PipelineAppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ selected }, user] = await Promise.all([getAccountContext(), getCurrentUser()]);
  const query = new URLSearchParams(pipelineScope(selected));
  const { app, pipelines, deployments, issues } = await apiGet<PipelineAppDetail>(
    `/pipelines/apps/${encodeURIComponent(id)}?${query}`,
  );

  const running = pipelines.filter(
    ({ latestRun }) => latestRun && isActivePipelineStatus(latestRun.status),
  );
  const failed = pipelines.filter(({ latestRun }) => latestRun?.status === 'failure');
  const passing = pipelines.filter(({ latestRun }) => latestRun?.status === 'success');

  return (
    <>
      <LiveRefresh active={running.length > 0} />
      <Link
        href="/pipelines"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Pipelines
      </Link>
      <PageHeader
        title={app.name}
        description={app.repository}
        action={
          hasPermission(user, 'pipeline_apps.manage') ? (
            <DeleteAppButton id={app.id} name={app.name} />
          ) : undefined
        }
      />
      <PipelineIssues issues={issues} />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Pipeline summary">
        <StatTile label="Pipelines" value={pipelines.length} />
        <StatTile label="Running now" value={running.length} tone={running.length ? 'warning' : 'default'} />
        <StatTile label="Failed" value={failed.length} tone={failed.length ? 'danger' : 'default'} />
        <StatTile label="Passing" value={passing.length} tone={passing.length ? 'success' : 'default'} />
      </section>
      {deployments.length > 0 && <DeploymentTimeTiles times={deployments} />}
      {running.length > 0 && (
        <Card className="border-primary/40">
          <CardHeader title="Running now" description="Updates every few seconds" />
          <PipelineTable pipelines={running} showRepository={false} />
        </Card>
      )}
      {pipelines.length > 0 ? (
        <Card>
          <CardHeader title={`All pipelines (${pipelines.length})`} />
          <PipelineTable pipelines={pipelines} showRepository={false} />
        </Card>
      ) : (
        <EmptyState
          icon={GitBranch}
          title="No pipelines found"
          description={
            app.connectionId
              ? 'This repository has no pipelines for the selected account.'
              : 'This app needs a Git connection. An admin can add it under Settings > Integrations.'
          }
        />
      )}
    </>
  );
}
