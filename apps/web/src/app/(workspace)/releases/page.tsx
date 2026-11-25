import {
  hasPermission,
  isActiveRelease,
  type ReleaseChoices,
  type ReleasesOverview,
} from '@pulsegrid/shared';
import { GitBranch, Rocket } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { LiveRefresh } from '@/components/ui/live-refresh';
import { NoAccountsState } from '@/components/no-accounts-state';
import { LinkServiceButton } from '@/components/releases/link-service-button';
import { ReleaseCard } from '@/components/releases/release-card';
import { CardGridSkeleton, HeaderSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { getAccountContext } from '@/lib/account-context';
import { readyLabel, releaseCounts } from '@/lib/releases';
import { apiGet, getCurrentUser } from '@/lib/server-api';

async function ReleasesContent() {
  const [user, { selected }] = await Promise.all([getCurrentUser(), getAccountContext()]);
  if (!selected) {
    return <NoAccountsState />;
  }
  const { id: accountId, isProduction: production } = selected;
  const query = new URLSearchParams({ account: accountId });
  const { configured, releases } = await apiGet<ReleasesOverview>(`/releases?${query}`);
  const title = `Releases · ${selected.environmentName ?? selected.name}`;
  const description = `From build to ${readyLabel(production).toLowerCase()}`;

  if (!configured) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <EmptyState
          icon={GitBranch}
          title="Connect Git"
          description="Connect a Git provider and create an app to follow its releases."
          action={
            <Button asChild variant="primary">
              <Link href="/pipelines">Go to Pipelines</Link>
            </Button>
          }
        />
      </>
    );
  }

  const canManage = hasPermission(user, 'pipeline_apps.manage');
  const linkButton = canManage ? (
    <LinkServiceButton key={accountId} choices={await apiGet<ReleaseChoices>(`/releases/choices?${query}`)} />
  ) : undefined;
  const { inProgress, ready, failed } = releaseCounts(releases);

  return (
    <>
      <LiveRefresh active={releases.some(({ state }) => isActiveRelease(state))} />
      <PageHeader title={title} description={description} action={linkButton} />
      {releases.length > 0 ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Summary">
            <StatTile label="In progress" value={inProgress} />
            <StatTile label={readyLabel(production)} value={ready} tone={ready > 0 ? 'success' : 'default'} />
            <StatTile label="Failed" value={failed} tone={failed > 0 ? 'danger' : 'default'} />
          </section>
          <section className="grid gap-3" aria-label="Releases">
            {releases.map((release) => (
              <ReleaseCard key={release.id} release={release} canManage={canManage} production={production} />
            ))}
          </section>
        </>
      ) : (
        <EmptyState
          icon={Rocket}
          title="Link your first service"
          description={
            canManage
              ? `Link a pipeline to the ECS service it deploys to in ${selected.name}, and follow it here.`
              : 'A developer or admin needs to link a pipeline to its ECS service first.'
          }
          action={linkButton}
        />
      )}
    </>
  );
}

export default function ReleasesPage() {
  return (
    <Suspense
      fallback={
        <>
          <HeaderSkeleton />
          <CardGridSkeleton />
        </>
      }
    >
      <ReleasesContent />
    </Suspense>
  );
}
