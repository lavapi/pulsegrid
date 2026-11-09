'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const EMPTY_VALUE = '__empty__';

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
}

const toRadixValue = (value: string): string => value || EMPTY_VALUE;
const fromRadixValue = (value: string): string => (value === EMPTY_VALUE ? '' : value);

interface DropdownProps {
  options: DropdownOption[];
  label: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function Dropdown({
  options,
  label,
  name,
  value,
  defaultValue = '',
  onValueChange,
  disabled,
  className,
}: DropdownProps) {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const current = value ?? internalValue;
  const hiddenInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = hiddenInput.current?.form;
    if (!form) {
      return;
    }
    const reset = () => setInternalValue(defaultValue);
    form.addEventListener('reset', reset);
    return () => form.removeEventListener('reset', reset);
  }, [defaultValue]);

  const change = (next: string) => {
    const selected = fromRadixValue(next);
    setInternalValue(selected);
    onValueChange?.(selected);
  };

  return (
    <>
      {name && <input ref={hiddenInput} type="hidden" name={name} value={current} />}
      <SelectPrimitive.Root
        value={toRadixValue(current)}
        onValueChange={change}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          aria-label={label}
          className={cn(
            'group inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border bg-card px-3 text-sm font-normal text-foreground transition-colors hover:bg-muted focus:border-primary focus:outline-none focus:ring-4 focus:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:border-primary data-[state=open]:ring-4 data-[state=open]:ring-ring',
            className,
          )}
        >
          <span className="truncate">
            <SelectPrimitive.Value />
          </span>
          <SelectPrimitive.Icon>
            <ChevronDown
              className="size-4 shrink-0 text-faint transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className="z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-popover-border bg-popover text-sm shadow-2xl shadow-black/30 data-[state=open]:animate-[dropdown-in_120ms_ease-out]"
          >
            <SelectPrimitive.Viewport className="p-1.5">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={toRadixValue(option.value)}
                  textValue={option.label}
                  className="flex cursor-pointer select-none items-center gap-3 rounded-lg px-2.5 py-2 outline-none transition-colors data-[highlighted]:bg-ring data-[state=checked]:font-medium"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    </span>
                    {option.description && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </span>
                  <SelectPrimitive.ItemIndicator>
                    <Check className="size-4 text-primary" aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </>
  );
}
