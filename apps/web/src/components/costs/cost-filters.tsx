import type { AccountCosts } from '@pulsegrid/shared';
import type { DropdownOption } from '@/components/ui/dropdown';
import { FilterDropdown } from '@/components/ui/filter-dropdown';

const environmentOptions = (accounts: readonly AccountCosts[]): DropdownOption[] => {
  const environments = new Map(
    accounts.flatMap(({ environmentId, environmentName }) =>
      environmentId && environmentName ? [[environmentId, environmentName] as const] : [],
    ),
  );
  return [...environments].map(([value, label]) => ({ value, label }));
};

export function CostFilters({ accounts }: { accounts: readonly AccountCosts[] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filters">
      <FilterDropdown
        name="account"
        label="Account"
        options={accounts.map(({ accountId, accountName }) => ({ value: accountId, label: accountName }))}
      />
      <FilterDropdown name="environment" label="Environment" options={environmentOptions(accounts)} />
    </section>
  );
}
