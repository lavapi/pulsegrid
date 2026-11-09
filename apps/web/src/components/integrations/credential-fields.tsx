'use client';

import type { CredentialField } from '@pulsegrid/shared';
import { Field, Input } from '@/components/ui/input';

export type CredentialValues = Record<string, string>;

interface CredentialFieldsProps {
  fields: readonly CredentialField[];
  values: CredentialValues;
  onChange: (values: CredentialValues) => void;
}

export const isComplete = (
  fields: readonly CredentialField[],
  values: CredentialValues,
): boolean => fields.every(({ key }) => (values[key] ?? '') !== '');

export function CredentialFields({ fields, values, onChange }: CredentialFieldsProps) {
  return fields.map(({ key, label, secret, placeholder, hint }) => (
    <Field label={label} key={key} {...(hint ? { hint } : {})}>
      <Input
        value={values[key] ?? ''}
        required
        spellCheck={false}
        type={secret ? 'password' : 'text'}
        autoComplete={secret ? 'new-password' : 'off'}
        {...(placeholder ? { placeholder } : {})}
        onChange={(event) => onChange({ ...values, [key]: event.target.value })}
      />
    </Field>
  ));
}
