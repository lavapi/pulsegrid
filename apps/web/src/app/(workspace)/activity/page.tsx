import { ACTIVITY_CATEGORIES, type AuditEventPage, hasPermission } from '@pulsegrid/shared';
import { History } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { ActivityFilters } from '@/components/activity/activity-filters';
import {
  CloudActivityFilters,
  CloudActivitySection,
} from '@/components/activity/cloud-activity-section';
import { ActivityTable } from '@/components/activity/activity-table';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { getAccountContext } from '@/lib/account-context';
import { apiGet, getCurrentUser } from '@/lib/server-api';

const FILTERS = ['cursor', 'actor', 'account', 'category'] as const;
const END_OF_DAY = 'T23:59:59.999Z';

const auditQuery = (params: Record<string, string | undefined>): URLSearchParams => {
  const query = new URLSearchParams();
  FILTERS.forEach((name) => {
    const value = params[name];
    if (value) {
      query.set(name, value);
    }
  });
  if (params['from']) {
    query.set('from', params['from']);
  }
  if (params['to']) {
    query.set('to', `${params['to']}${END_OF_DAY}`);
  }
  return query;
};

type ActivityParams = Record<string, string | undefined>;

async function DashboardActivity({ params }: { params: ActivityParams }) {
  const [{ events, nextCursor }, people, { accounts }] = await Promise.all([
    apiGet<AuditEventPage>(`/audit-events?${auditQuery(params)}`),
    apiGet<string[]>('/audit-events/actors'),
    getAccountContext(),
  ]);
  const older = new URLSearchParams(
    Object.entries(params).flatMap(([key, value]) => (value ? [[key, value]] : [])),
  );
  older.set('cursor', nextCursor ?? '');

  return (
    <>
      <ActivityFilters
        people={people.map((email) => ({ value: email, label: email }))}
        accounts={accounts.map(({ id, name, environmentName }) => ({
          value: id,
          label: environmentName ? `${name} (${environmentName})` : name,
        }))}
        categories={Object.entries(ACTIVITY_CATEGORIES).map(([value, { label }]) => ({ value, label }))}
      />
      {events.length > 0 ? (
        <ActivityTable events={events} />
      ) : (
        <EmptyState icon={History} title="No activity found" description="Try different filters." />
      )}
      {nextCursor && (
        <Button asChild className="w-fit">
          <Link href={`/activity?${older}`}>Older events</Link>
        </Button>
      )}
    </>
  );
}

async function AwsActivity({ params }: { params: ActivityParams }) {
  const { selected } = await getAccountContext();
  if (!selected) {
    return <EmptyState icon={History} title="No account selected" description="Connect an AWS account first." />;
  }
  return (
    <>
      <p className="text-[13px] text-muted-foreground">
        From AWS Event history for {selected.name}. New events usually take about 15 minutes to appear.
      </p>
      <CloudActivityFilters params={params} />
      <Suspense
        key={`${selected.id}:${JSON.stringify(params)}`}
        fallback={<Skeleton className="h-64" />}
      >
        <CloudActivitySection account={selected} params={params} />
      </Suspense>
    </>
  );
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<ActivityParams>;
}) {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'activity.view')) {
    redirect('/');
  }
  const { view, ...params } = await searchParams;
  const aws = view === 'aws';

  return (
    <>
      <PageHeader
        title="Activity"
        description="Who did what"
        action={
          <div className="flex rounded-lg border p-0.5" role="group" aria-label="Activity source">
            <Button asChild size="sm" variant={aws ? 'ghost' : 'secondary'}>
              <Link href="/activity">Dashboard</Link>
            </Button>
            <Button asChild size="sm" variant={aws ? 'secondary' : 'ghost'}>
              <Link href="/activity?view=aws">AWS</Link>
            </Button>
          </div>
        }
      />
      {aws ? <AwsActivity params={params} /> : <DashboardActivity params={params} />}
    </>
  );
}
