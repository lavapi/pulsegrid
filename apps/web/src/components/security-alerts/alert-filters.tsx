'use client';

import type { DropdownOption } from '@/components/ui/dropdown';
import { FilterDropdown } from '@/components/ui/filter-dropdown';
import { Field, Input } from '@/components/ui/input';
import { SEVERITY_OPTIONS, SOURCE_OPTIONS, STATUS_OPTIONS } from '@/lib/security-alerts';
import { useUrlFilters } from '@/lib/use-url-filters';

export function AlertFilters({ accounts, regions }: { accounts: DropdownOption[]; regions: DropdownOption[] }) {
  const { value, change } = useUrlFilters();

  const date = (name: string, label: string) => (
    <Field label={label}>
      <Input type="date" value={value(name)} onChange={(event) => change(name, event.target.value)} />
    </Field>
  );

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" aria-label="Filters">
      <FilterDropdown name="severity" label="Severity" options={SEVERITY_OPTIONS} />
      <FilterDropdown name="source" label="Source" options={SOURCE_OPTIONS} />
      <FilterDropdown name="account" label="Account" options={accounts} />
      <FilterDropdown name="region" label="Region" options={regions} />
      <FilterDropdown name="status" label="Status" options={STATUS_OPTIONS} />
      {date('from', 'From')}
      {date('to', 'To')}
    </section>
  );
}
