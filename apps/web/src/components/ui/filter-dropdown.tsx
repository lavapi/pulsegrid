'use client';

import { Dropdown, type DropdownOption } from '@/components/ui/dropdown';
import { Field } from '@/components/ui/input';
import { useUrlFilters } from '@/lib/use-url-filters';

export function FilterDropdown({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: DropdownOption[];
}) {
  const { value, change } = useUrlFilters();
  return (
    <Field label={label} labelsOwnControl>
      <Dropdown
        label={label}
        value={value(name)}
        onValueChange={(next) => change(name, next)}
        options={[{ value: '', label: 'All' }, ...options]}
      />
    </Field>
  );
}
