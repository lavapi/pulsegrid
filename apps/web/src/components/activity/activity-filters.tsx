'use client';

import type { DropdownOption } from '@/components/ui/dropdown';
import { FilterDropdown } from '@/components/ui/filter-dropdown';
import { Field, Input } from '@/components/ui/input';
import { useUrlFilters } from '@/lib/use-url-filters';

interface ActivityFiltersProps {
  people: DropdownOption[];
  accounts: DropdownOption[];
  categories: DropdownOption[];
}

export function ActivityFilters({ people, accounts, categories }: ActivityFiltersProps) {
  const { value, change } = useUrlFilters();

  const date = (name: string, label: string) => (
    <Field label={label}>
      <Input
        type="date"
        value={value(name)}
        onChange={(event) => change(name, event.target.value)}
      />
    </Field>
  );

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filters">
      <FilterDropdown name="actor" label="Person" options={people} />
      <FilterDropdown name="account" label="Account" options={accounts} />
      <FilterDropdown name="category" label="Type" options={categories} />
      {date('from', 'From')}
      {date('to', 'To')}
    </section>
  );
}
