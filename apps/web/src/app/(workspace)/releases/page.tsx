import {
  hasPermission,
  isActiveRelease,
  type ReleaseChoices,
  type ReleasesOverview,
} from '@pulsegrid/shared';
import { GitBranch, Rocket } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { LinkServiceButton } from '@/components/releases/link-service-button';
import { ReleaseCard } from '@/components/releases/release-card';
import { CardGridSkeleton, HeaderSkeleton } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { releaseCounts } from '@/lib/releases';
import { apiGet, getCurrentUser } from '@/lib/server-api';

const DESCRIPTION = 'From build to ready for testing';

async function ReleasesContent() {
  const user = await getCurrentUser();
  const { configured, releases } = await apiGet<ReleasesOverview>('/releases');

  if (!configured) {
    return (
      <>
        <PageHeader title="Releases" description={DESCRIPTION} />
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
    <LinkServiceButton choices={await apiGet<ReleaseChoices>('/releases/choices')} />
  ) : undefined;
  const { inProgress, ready, failed } = releaseCounts(releases);

  return (
    <>
      <LiveRefresh active={releases.some(({ state }) => isActiveRelease(state))} />
      <PageHeader title="Releases" description={DESCRIPTION} action={linkButton} />
      {releases.length > 0 ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label="Summary">
            <StatTile label="In progress" value={inProgress} />
            <StatTile label="Ready for testing" value={ready} tone={ready > 0 ? 'success' : 'default'} />
            <StatTile label="Failed" value={failed} tone={failed > 0 ? 'danger' : 'default'} />
          </section>
          <section className="grid gap-3" aria-label="Releases">
            {releases.map((release) => (
              <ReleaseCard key={release.id} release={release} canManage={canManage} />
            ))}
          </section>
        </>
      ) : (
        <EmptyState
          icon={Rocket}
          title="Link your first service"
          description={
            canManage
              ? 'Link a pipeline to the ECS service it deploys to, and follow it here from build to ready for testing.'
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
