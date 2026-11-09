import {
  type CloudAccount,
  hasPermission,
  type ServiceCategorySummary,
} from '@pulsegrid/shared';
import { Network, Search, ServerOff } from 'lucide-react';
import Link from 'next/link';
import { SyncNowButton } from '@/components/account-actions';
import { NoAccountsState } from '@/components/no-accounts-state';
import { ResourceTable } from '@/components/resource-table';
import { ServiceGrid } from '@/components/service-grid';
import { CardGridSkeleton } from '@/components/skeletons';
import { SyncProgressCards } from '@/components/sync/sync-progress-card';
import { WhileSyncing } from '@/components/sync/while-syncing';
import { HealthTiles } from '@/components/service-summary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Dropdown } from '@/components/ui/dropdown';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { getAccountContext } from '@/lib/account-context';
import { addHealth, EMPTY_HEALTH } from '@/lib/health';
import {
  accountParams,
  filterParams,
  type InfrastructureFilters,
  withQuery,
} from '@/lib/infrastructure-filters';
import { loadResources } from '@/lib/resources';
import { apiGet, getCurrentUser } from '@/lib/server-api';

function FilterForm({ filters, regions }: { filters: InfrastructureFilters; regions: string[] }) {
  return (
    <form className="flex flex-wrap items-center gap-2.5" action="/infrastructure">
      <div className="relative min-w-52 flex-1 sm:max-w-sm">
        <Search
          className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <Input
          name="q"
          defaultValue={filters.q}
          placeholder="Search by name or ID"
          aria-label="Search by name or ID"
          className="pl-9"
        />
      </div>
      <Dropdown
        name="region"
        label="Region"
        defaultValue={filters.region ?? ''}
        className="w-auto min-w-44"
        options={[
          { value: '', label: 'All regions' },
          ...regions.map((region) => ({ value: region, label: region })),
        ]}
      />
      <Button>Apply</Button>
    </form>
  );
}

function SyncStatus({ account, canSync }: { account: CloudAccount; canSync: boolean }) {
  const issues = account.syncIssues.length;
  const showSyncButton = canSync && account.hasCredentials;
  return (
    <div className="flex items-center gap-2.5">
      {!account.hasCredentials && <Badge tone="warning">Needs credentials</Badge>}
      {issues > 0 && (
        <Badge tone="danger" dot>
          {issues} area{issues === 1 ? '' : 's'} couldn&apos;t be read
        </Badge>
      )}
      {showSyncButton && <SyncNowButton accountId={account.id} />}
    </div>
  );
}

export default async function InfrastructurePage({
  searchParams,
}: {
  searchParams: Promise<InfrastructureFilters>;
}) {
  const filters = await searchParams;
  const [user, { selected }] = await Promise.all([getCurrentUser(), getAccountContext()]);
  if (!selected) {
    return <NoAccountsState />;
  }

  const filterQuery = filterParams(filters);
  const params = accountParams(selected.id, filterQuery);
  const [categories, matches] = await Promise.all([
    apiGet<ServiceCategorySummary[]>(withQuery('/resources/categories', params)),
    filters.q ? loadResources(params) : Promise.resolve([]),
  ]);
  const health = categories.reduce((total, { health: item }) => addHealth(total, item), EMPTY_HEALTH);

  return (
    <>
      <PageHeader
        title="Infrastructure"
        description={`Your cloud services in ${selected.name}`}
        action={
          <div className="flex flex-wrap items-center gap-2.5">
            <SyncStatus account={selected} canSync={hasPermission(user, 'accounts.sync')} />
            <Button asChild>
              <Link href="/infrastructure/map">
                <Network />
                View map
              </Link>
            </Button>
          </div>
        }
      />
      <SyncProgressCards />
      {categories.length > 0 && <HealthTiles health={health} serviceCount={categories.length} />}
      <FilterForm filters={filters} regions={selected.regions} />
      {categories.length > 0 ? (
        <ServiceGrid
          categories={categories}
          hrefFor={({ category }) => withQuery(`/infrastructure/${category}`, filterQuery)}
        />
      ) : (
        <WhileSyncing loading={<CardGridSkeleton />}>
          <EmptyState
            icon={ServerOff}
            title="No services match"
            description="Try a different search or region, or switch to another account."
          />
        </WhileSyncing>
      )}
      {filters.q && matches.length > 0 && (
        <Card>
          <CardHeader title="Search results" description={`${matches.length} matching resources`} />
          <ResourceTable resources={matches} columnSet="summary" />
        </Card>
      )}
    </>
  );
}
