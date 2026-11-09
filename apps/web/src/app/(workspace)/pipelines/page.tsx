import {
  type CloudAccount,
  type PipelineAppsOverview,
  type RepositoryChoice,
  hasPermission,
} from '@pulsegrid/shared';
import { Boxes, GitBranch } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { AppCard } from '@/components/pipelines/app-card';
import { CreateAppButton } from '@/components/pipelines/create-app-button';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { PipelineIssues } from '@/components/pipelines/pipeline-issues';
import { CardGridSkeleton, HeaderSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getAccountContext } from '@/lib/account-context';
import { pipelineScope } from '@/lib/account-selection';
import { apiGet, getCurrentUser } from '@/lib/server-api';

const DESCRIPTION = 'Your apps and their pipelines';

async function PipelinesContent({ selected }: { selected: CloudAccount | null }) {
  const user = await getCurrentUser();
  const query = new URLSearchParams(pipelineScope(selected));
  const { configured, apps, issues } = await apiGet<PipelineAppsOverview>(
    `/pipelines/apps?${query}`,
  );

  const canConnect = hasPermission(user, 'integrations.manage');

  if (!configured) {
    return (
      <>
        <PageHeader title="Pipelines" description={DESCRIPTION} />
        <EmptyState
          icon={GitBranch}
          title="Connect Git"
          description={
            canConnect
              ? 'Connect a Git provider to see and run your pipelines.'
              : 'An admin needs to connect a Git provider first.'
          }
          action={
            canConnect && (
              <Button asChild variant="primary">
                <Link href="/settings/integrations">Go to Integrations</Link>
              </Button>
            )
          }
        />
      </>
    );
  }

  const canManageApps = hasPermission(user, 'pipeline_apps.manage');
  const createButton = canManageApps ? (
    <CreateAppButton repositories={await apiGet<RepositoryChoice[]>('/pipelines/apps/repositories')} />
  ) : undefined;

  return (
    <>
      <LiveRefresh active={apps.some(({ running }) => running > 0)} />
      <PageHeader
        title="Pipelines"
        description={selected ? `${DESCRIPTION} in ${selected.name}` : DESCRIPTION}
        action={apps.length > 0 ? createButton : undefined}
      />
      <PipelineIssues issues={issues} />
      {apps.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Apps">
          {apps.map((app) => (
            <AppCard app={app} key={app.id} />
          ))}
        </section>
      ) : (
        <EmptyState
          icon={Boxes}
          title="No apps yet"
          description={
            canManageApps
              ? 'Create an app to see the pipelines of a repository.'
              : 'A developer or admin needs to create an app before its pipelines appear here.'
          }
          action={createButton}
        />
      )}
    </>
  );
}

export default async function PipelinesPage() {
  const { selected } = await getAccountContext();
  return (
    <Suspense
      key={selected?.id ?? 'all'}
      fallback={
        <>
          <HeaderSkeleton />
          <CardGridSkeleton />
        </>
      }
    >
      <PipelinesContent selected={selected} />
    </Suspense>
  );
}
