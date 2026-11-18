import { hasPermission, type ProductionRelease, type ProductionReleasesView } from '@pulsegrid/shared';
import { Rocket } from 'lucide-react';
import { redirect } from 'next/navigation';
import { CurrentRelease } from '@/components/production-releases/current-release';
import { ReleaseHistory } from '@/components/production-releases/release-history';
import { EmptyState } from '@/components/ui/empty-state';
import { LiveRefresh } from '@/components/ui/live-refresh';
import { PageHeader } from '@/components/ui/page-header';
import { isInFlight } from '@/lib/production-releases';
import { apiGetOptional, getCurrentUser } from '@/lib/server-api';

const IN_FLIGHT_REFRESH_MS = 10_000;
const CANT_READ = "PulseGrid couldn't read the production release right now. Try again in a minute.";

export default async function ProductionReleasesPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'production.release.decide')) {
    redirect('/');
  }
  const [view, history] = await Promise.all([
    apiGetOptional<ProductionReleasesView>('/production-releases/current'),
    apiGetOptional<ProductionRelease[]>('/production-releases/history'),
  ]);

  return (
    <>
      <PageHeader
        title="Production releases"
        description="Finish or roll back a production release while it waits for a decision"
      />
      {!view ? (
        <>
          <LiveRefresh active={false} />
          <EmptyState icon={Rocket} title="Can't read production" description={CANT_READ} />
        </>
      ) : view.ready ? (
        <>
          <LiveRefresh active={isInFlight(view.current)} activeMs={IN_FLIGHT_REFRESH_MS} />
          <CurrentRelease release={view.current} />
          {history ? (
            history.length > 0 && <ReleaseHistory releases={history} />
          ) : (
            <p className="text-[13px] text-muted-foreground">Recent releases couldn&apos;t be loaded right now.</p>
          )}
        </>
      ) : (
        <EmptyState
          icon={Rocket}
          title="Not set up"
          description="Production releases aren't set up in PulseGrid yet."
        />
      )}
    </>
  );
}
