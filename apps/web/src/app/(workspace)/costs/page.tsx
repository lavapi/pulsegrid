import { type CostOverview, hasPermission } from '@pulsegrid/shared';
import { CircleDollarSign } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AccountCostsCard } from '@/components/costs/account-costs-card';
import { CostFilters } from '@/components/costs/cost-filters';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { type CostTotal, filteredAccounts, formatMoney, monthName, totalsByCurrency } from '@/lib/costs';
import { apiGet, getCurrentUser } from '@/lib/server-api';

const NO_TOTAL = '—';

const shownTotal = (totals: readonly CostTotal[], month: 'thisMonth' | 'lastMonth'): string =>
  totals.map((total) => formatMoney(total[month], total.currency)).join(' + ') || NO_TOTAL;

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'costs.view')) {
    redirect('/');
  }
  const [{ month, lastMonth, accounts }, { account, environment }] = await Promise.all([
    apiGet<CostOverview>('/costs'),
    searchParams,
  ]);
  const shown = filteredAccounts(accounts, { account, environment });
  const totals = totalsByCurrency(shown);

  return (
    <>
      <PageHeader title="Costs" description="What each account and service costs" />
      {accounts.length === 0 ? (
        <EmptyState
          icon={CircleDollarSign}
          title="No accounts connected"
          description="Connect a cloud account to see its costs."
        />
      ) : (
        <>
          <CostFilters accounts={accounts} />
          <section className="grid gap-3 sm:grid-cols-2" aria-label="Totals">
            <StatTile label={`${monthName(month)} so far`} value={shownTotal(totals, 'thisMonth')} />
            <StatTile label={monthName(lastMonth)} value={shownTotal(totals, 'lastMonth')} />
          </section>
          {shown.length > 0 ? (
            shown.map((item) => (
              <AccountCostsCard key={item.accountId} account={item} month={month} lastMonth={lastMonth} />
            ))
          ) : (
            <EmptyState
              icon={CircleDollarSign}
              title="No accounts found"
              description="Try different filters."
            />
          )}
          <p className="text-xs text-muted-foreground">
            From your cloud provider, refreshed every 6 hours. Figures can lag by up to a day, so your bill
            may differ slightly.
          </p>
        </>
      )}
    </>
  );
}
