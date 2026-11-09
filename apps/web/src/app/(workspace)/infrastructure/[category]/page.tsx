import {
  type ActionRun,
  isServiceCategory,
  RESOURCE_TYPES,
  resourceTypesIn,
  SERVICE_CATEGORIES,
  type ServiceCategorySummary,
} from '@pulsegrid/shared';
import { ArrowLeft, ServerOff } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HealthSummaryBadge } from '@/components/health-badge';
import { ResourceCardSections } from '@/components/infrastructure/resource-card-sections';
import { NoAccountsState } from '@/components/no-accounts-state';
import { ResourceTable } from '@/components/resource-table';
import { ServiceIcon } from '@/components/service-icon';
import { HealthTiles } from '@/components/service-summary';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getAccountContext } from '@/lib/account-context';
import { byHealthThenName } from '@/lib/health';
import {
  accountParams,
  filterParams,
  type InfrastructureFilters,
  withQuery,
} from '@/lib/infrastructure-filters';
import { usesCards } from '@/lib/resource-cards';
import { loadResources } from '@/lib/resources';
import { apiGet } from '@/lib/server-api';
import { categoryTitle } from '@/lib/service-views';

export default async function ServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<InfrastructureFilters>;
}) {
  const { category } = await params;
  if (!isServiceCategory(category)) {
    notFound();
  }
  const { selected } = await getAccountContext();
  if (!selected) {
    return <NoAccountsState />;
  }
  const filters = filterParams(await searchParams);
  const categoryFilters = accountParams(selected.id, filters);
  categoryFilters.set('category', category);

  const [categories, resources, runs] = await Promise.all([
    apiGet<ServiceCategorySummary[]>(withQuery('/resources/categories', categoryFilters)),
    loadResources(categoryFilters),
    apiGet<ActionRun[]>(`/resource-activity?account=${selected.id}`),
  ]);
  const summary = categories[0];
  const back = (
    <Link
      href={withQuery('/infrastructure', filters)}
      className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      Infrastructure
    </Link>
  );

  if (!summary) {
    return (
      <>
        {back}
        <EmptyState
          icon={ServerOff}
          title={`No ${SERVICE_CATEGORIES[category].label} resources here`}
          description={`There's nothing to show in ${selected.name} with your access.`}
        />
      </>
    );
  }

  const attention = resources.filter(({ health }) => health === 'degraded');

  return (
    <>
      {back}
      <PageHeader
        leading={<ServiceIcon category={category} size={48} />}
        title={categoryTitle(summary)}
        description={`${SERVICE_CATEGORIES[category].description} in ${selected.name}`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <HealthSummaryBadge health={summary.health} />
          </div>
        }
      />
      <HealthTiles health={summary.health} />
      {usesCards(category) && (
        <ResourceCardSections
          key={selected.id}
          accountId={selected.id}
          types={resourceTypesIn(category)}
          resources={[...resources].sort(byHealthThenName)}
          initialRuns={runs}
        />
      )}
      {!usesCards(category) && attention.length > 0 && (
        <Card className="border-danger/40">
          <CardHeader
            title="Needs attention"
            description={`${attention.length} of ${resources.length} resources`}
          />
          <ResourceTable resources={attention.sort(byHealthThenName)} columnSet="summary" />
        </Card>
      )}
      {!usesCards(category) &&
        resourceTypesIn(category).map((type) => {
          const items = resources.filter((item) => item.type === type).sort(byHealthThenName);
          return (
            items.length > 0 && (
              <Card key={type}>
                <CardHeader title={`${RESOURCE_TYPES[type].label} (${items.length})`} />
                <ResourceTable resources={items} columnSet={type} />
              </Card>
            )
          );
        })}
    </>
  );
}
