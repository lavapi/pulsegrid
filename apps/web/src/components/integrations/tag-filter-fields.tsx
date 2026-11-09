'use client';

import type { TagFilter, TagRule } from '@pulsegrid/shared';
import { Plus, X } from 'lucide-react';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { TagSuggestion } from '@/lib/tag-suggestions';

type RuleList = 'include' | 'exclude';

const LISTS: { list: RuleList; title: string; hint: string }[] = [
  { list: 'include', title: 'Include', hint: 'Keep only resources matching any of these. Leave empty to keep everything.' },
  { list: 'exclude', title: 'Exclude', hint: 'Remove resources matching any of these. Exclude always wins.' },
];

interface TagFilterFieldsProps {
  value: TagFilter;
  onChange: (value: TagFilter) => void;
  suggestions?: TagSuggestion[];
}

export function TagFilterFields({ value, onChange, suggestions = [] }: TagFilterFieldsProps) {
  const id = useId();
  const keysId = `${id}-keys`;

  const setRules = (list: RuleList, rules: TagRule[]) => onChange({ ...value, [list]: rules });
  const update = (list: RuleList, index: number, change: Partial<TagRule>) =>
    setRules(
      list,
      value[list].map((rule, position) => (position === index ? { ...rule, ...change } : rule)),
    );

  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border p-4">
      <legend className="px-1 text-[13px] font-medium">Tag filters (optional)</legend>
      <p className="text-[13px] text-muted-foreground">
        Choose which resources to show. VPCs, subnets and security groups are always kept. Leave a value empty
        to match any value.
      </p>
      <datalist id={keysId}>
        {suggestions.map(({ key }) => (
          <option value={key} key={key} />
        ))}
      </datalist>
      {LISTS.map(({ list, title, hint }) => (
        <div className="flex flex-col gap-2" key={list}>
          <div>
            <p className="text-[13px] font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
          {value[list].map((rule, index) => {
            const valuesId = `${id}-${list}-${index}`;
            const values = suggestions.find(({ key }) => key === rule.key)?.values ?? [];
            return (
              <div className="flex items-center gap-2" key={valuesId}>
                <Input
                  aria-label={`${title} tag key`}
                  placeholder="Key"
                  list={keysId}
                  value={rule.key}
                  onChange={(event) => update(list, index, { key: event.target.value })}
                />
                <Input
                  aria-label={`${title} tag value`}
                  placeholder="Any value"
                  list={valuesId}
                  value={rule.value ?? ''}
                  onChange={(event) => update(list, index, { value: event.target.value })}
                />
                <datalist id={valuesId}>
                  {values.map((item) => (
                    <option value={item} key={item} />
                  ))}
                </datalist>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${title.toLowerCase()} rule`}
                  onClick={() => setRules(list, value[list].filter((_, position) => position !== index))}
                >
                  <X />
                </Button>
              </div>
            );
          })}
          <Button
            type="button"
            size="sm"
            className="self-start"
            onClick={() => setRules(list, [...value[list], { key: '', value: null }])}
          >
            <Plus />
            Add rule
          </Button>
        </div>
      ))}
      {value.include.length > 0 && (
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={value.keepUntagged}
            onChange={(event) => onChange({ ...value, keepUntagged: event.target.checked })}
          />
          Keep untagged resources
        </label>
      )}
    </fieldset>
  );
}
