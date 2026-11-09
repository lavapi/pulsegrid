'use client';

import { Field } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const toggled = (items: readonly string[], item: string): string[] =>
  items.includes(item) ? items.filter((value) => value !== item) : [...items, item];

interface RegionPickerProps {
  regions: readonly string[];
  selected: string[];
  onChange: (regions: string[]) => void;
}

export function RegionPicker({ regions, selected, onChange }: RegionPickerProps) {
  return (
    <Field label="Regions" labelsOwnControl>
      <div className="flex flex-wrap gap-2">
        {regions.map((region) => (
          <button
            type="button"
            key={region}
            aria-pressed={selected.includes(region)}
            onClick={() => onChange(toggled(selected, region))}
            className={cn(
              'h-8 rounded-lg border px-3 text-[13px] transition-colors hover:bg-muted',
              selected.includes(region)
                ? 'border-primary bg-primary/10 text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {region}
          </button>
        ))}
      </div>
    </Field>
  );
}
