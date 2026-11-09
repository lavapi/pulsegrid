import type {
  ActionRun,
  CloudAccount,
  PipelineActivity,
  Resource,
  ServiceCategorySummary,
} from '@pulsegrid/shared';
import { Cloud } from 'lucide-react';
import { Suspense } from 'react';
import { EnvironmentBadge } from '@/components/environment-badge';
import { NoAccountsState } from '@/components/no-accounts-state';
import { OverviewQuickLinks } from '@/components/overview/overview-quick-links';
import { PipelineActivityCard } from '@/components/overview/pipeline-activity-card';
import { ProblemsCard } from '@/components/overview/problems-card';
import { SystemStatusBanner } from '@/components/overview/system-status-banner';
import { type WorkInProgress, WorkInProgressCard } from '@/components/overview/work-in-progress-card';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { PipelineIssues } from '@/components/pipelines/pipeline-issues';
import { ServiceGrid } from '@/components/service-grid';
import { Skeleton } from '@/components/ui/skeleton';
import { HealthTiles } from '@/components/service-summary';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { pipelineScope } from '@/lib/account-selection';
import { getAccountContext } from '@/lib/account-context';
import { addHealth, EMPTY_HEALTH } from '@/lib/health';
import { accountParams, withQuery } from '@/lib/infrastructure-filters';
import { loadResources } from '@/lib/resources';
import { apiGet, apiGetOptional } from '@/lib/server-api';
import { systemStatus } from '@/lib/system-health';

const loadWork = async (accountId: string): Promise<WorkInProgress[]> => {
  const runs = await apiGet<ActionRun[]>(`/resource-activity?account=${accountId}`);
  const running = runs.filter(({ status }) => status === 'running');
  const items = await Promise.all(
    running.map(async (run) => {
      const resource = await apiGetOptional<Resource>(`/resources/${run.resourceId}`);
      return resource ? { run, resource } : null;
    }),
  );
  return items.filter((item) => item !== null);
};

const loadProblems = (account: CloudAccount): Promise<Resource[]> =>
  loadResources(new URLSearchParams({ account: account.id, health: 'degraded' }));

async function PipelineSection({ account }: { account: CloudAccount }) {
  const activity = await apiGet<PipelineActivity>(
    `/pipelines/apps/activity?${new URLSearchParams(pipelineScope(account))}`,
  );
  if (!activity.configured) {
    return null;
  }
  return (
    <>
      {activity.running.length > 0 && <LiveRefresh active />}
      <PipelineIssues issues={activity.issues} />
      <section className="grid gap-5 lg:grid-cols-2" aria-label="Pipelines">
        <PipelineActivityCard
          title="Running pipelines"
          empty="No pipelines are running."
          items={activity.running}
        />
        <PipelineActivityCard
          title="Failed in the last 24 hours"
          empty="No failures in the last 24 hours."
          items={activity.failed}
        />
      </section>
    </>
  );
}

function PipelineSectionLoading() {
  return (
    <section className="grid gap-5 lg:grid-cols-2" aria-label="Loading pipelines">
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </section>
  );
}

export default async function OverviewPage() {
  const { selected } = await getAccountContext();
  if (!selected) {
    return <NoAccountsState />;
  }

  const [categories, problems, work] = await Promise.all([
    apiGet<ServiceCategorySummary[]>(
      withQuery('/resources/categories', accountParams(selected.id, new URLSearchParams())),
    ),
    loadProblems(selected),
    loadWork(selected.id),
  ]);
  const health = categories.reduce((total, { health: item }) => addHealth(total, item), EMPTY_HEALTH);
  const status = systemStatus(selected, problems.length, Date.now());

  return (
    <>
      <LiveRefresh active={work.length > 0} />
      <PageHeader
        title="System health"
        description={selected.name}
        action={<EnvironmentBadge account={selected} />}
      />
      <SystemStatusBanner status={status} lastSyncedAt={selected.lastSyncedAt} />
      <Suspense key={`links-${selected.id}`} fallback={null}>
        <OverviewQuickLinks account={selected} />
      </Suspense>
      {problems.length > 0 && <ProblemsCard resources={problems} />}
      {categories.length > 0 ? (
        <HealthTiles health={health} serviceCount={categories.length} />
      ) : (
        <EmptyState
          icon={Cloud}
          title="Nothing to show in this account yet"
          description="Resources appear here after the next sync, if your access covers them."
        />
      )}
      {work.length > 0 && <WorkInProgressCard items={work} />}
      <Suspense key={selected.id} fallback={<PipelineSectionLoading />}>
        <PipelineSection account={selected} />
      </Suspense>
      {categories.length > 0 && (
        <ServiceGrid categories={categories} hrefFor={({ category }) => `/infrastructure/${category}`} />
      )}
    </>
  );
}
