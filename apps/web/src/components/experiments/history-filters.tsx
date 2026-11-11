'use client';

import { RUN_RESULTS } from '@pulsegrid/shared';
import { FilterDropdown } from '@/components/ui/filter-dropdown';
import { Field, Input } from '@/components/ui/input';
import { resultLabel } from '@/lib/experiments';
import { useUrlFilters } from '@/lib/use-url-filters';

const optionsOf = (values: readonly string[]) => values.map((value) => ({ value, label: value }));

export function HistoryFilters({ labels }: { labels: string[] }) {
  const { value, change } = useUrlFilters();

  const date = (name: string, label: string) => (
    <Field label={label}>
      <Input type="date" value={value(name)} onChange={(event) => change(name, event.target.value)} />
    </Field>
  );

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filters">
      <FilterDropdown name="label" label="Test or group" options={optionsOf(labels)} />
      <FilterDropdown
        name="result"
        label="Result"
        options={RUN_RESULTS.map((result) => ({ value: result, label: resultLabel(result) }))}
      />
      {date('from', 'From')}
      {date('to', 'To')}
    </section>
  );
}
