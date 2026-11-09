'use client';

import {
  DOMAIN_KIND_LABELS,
  DOMAIN_KINDS,
  type EnvironmentDomain,
  MAX_DOMAIN_LABEL_LENGTH,
  MAX_DOMAIN_URL_LENGTH,
} from '@pulsegrid/shared';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dropdown } from '@/components/ui/dropdown';
import { Field, Input } from '@/components/ui/input';

const KIND_OPTIONS = DOMAIN_KINDS.map((kind) => ({ value: kind, label: DOMAIN_KIND_LABELS[kind] }));

export interface DomainFormValues {
  kind: FormDataEntryValue | null;
  label: FormDataEntryValue | null;
  url: FormDataEntryValue | null;
}

export function DomainForm({
  environmentName,
  domain,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  environmentName: string;
  domain?: EnvironmentDomain;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: DomainFormValues, form: HTMLFormElement) => void;
  onCancel?: () => void;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    onSubmit({ kind: data.get('kind'), label: data.get('label'), url: data.get('url') }, form);
  };

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
      <Field label="Type" labelsOwnControl className="w-32">
        <Dropdown
          name="kind"
          label={`Domain type for ${environmentName}`}
          defaultValue={domain?.kind ?? 'app'}
          options={KIND_OPTIONS}
        />
      </Field>
      <Field label="Name (optional)" className="min-w-36 flex-1 sm:max-w-48">
        <Input
          name="label"
          maxLength={MAX_DOMAIN_LABEL_LENGTH}
          placeholder="Website"
          defaultValue={domain?.label ?? ''}
        />
      </Field>
      <Field label="Address" className="min-w-52 flex-[2]">
        <Input
          name="url"
          required
          maxLength={MAX_DOMAIN_URL_LENGTH}
          placeholder="app.example.com"
          defaultValue={domain?.url ?? ''}
        />
      </Field>
      <Button disabled={pending} variant={domain ? 'primary' : undefined}>
        {submitLabel}
      </Button>
      {onCancel && (
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      )}
    </form>
  );
}
