'use client';

import { Command } from 'cmdk';
import { Check, Search } from 'lucide-react';

interface SearchableListProps {
  label: string;
  placeholder: string;
  emptyMessage: string;
  options: { value: string; label: string; description?: string }[];
  value: string;
  onValueChange: (value: string) => void;
}

export function SearchableList({
  label,
  placeholder,
  emptyMessage,
  options,
  value,
  onValueChange,
}: SearchableListProps) {
  return (
    <Command label={label} className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
        <Command.Input
          placeholder={placeholder}
          className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </div>
      <Command.List className="max-h-48 overflow-y-auto p-1.5 text-sm">
        <Command.Empty className="py-6 text-center text-muted-foreground">
          {emptyMessage}
        </Command.Empty>
        {options.map((option) => (
          <Command.Item
            key={option.value}
            value={`${option.label} ${option.description ?? ''}`}
            onSelect={() => onValueChange(option.value)}
            className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-2.5 py-2 outline-none data-[selected=true]:bg-ring"
          >
            <span className="min-w-0">
              <span className="block truncate">{option.label}</span>
              {option.description && (
                <span className="block truncate text-xs text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
            {option.value === value && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
          </Command.Item>
        ))}
      </Command.List>
    </Command>
  );
}
