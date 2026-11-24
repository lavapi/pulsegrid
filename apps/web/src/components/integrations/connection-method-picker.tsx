'use client';

import type { ConnectionMethod, CredentialKind } from '@pulsegrid/shared';
import { Button } from '@/components/ui/button';

/** Choose how to connect, such as a role or an access key; the recommended one comes first. */
export function ConnectionMethodPicker({
  methods,
  value,
  onChange,
}: {
  methods: readonly ConnectionMethod[];
  value: CredentialKind;
  onChange: (kind: CredentialKind) => void;
}) {
  const chosen = methods.find(({ id }) => id === value);
  if (methods.length < 2) {
    return chosen && <p className="text-[13px] text-muted-foreground">{chosen.description}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex w-fit rounded-lg border p-0.5" role="group" aria-label="How to connect">
        {methods.map(({ id, label }, index) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={id === value ? 'secondary' : 'ghost'}
            aria-pressed={id === value}
            onClick={() => onChange(id)}
          >
            {label}
            {index === 0 && methods.length > 1 ? ' (recommended)' : ''}
          </Button>
        ))}
      </div>
      {chosen && <p className="text-[13px] text-muted-foreground">{chosen.description}</p>}
    </div>
  );
}
