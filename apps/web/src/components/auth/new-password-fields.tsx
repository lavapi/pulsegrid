'use client';

import { MIN_PASSWORD_LENGTH } from '@pulsegrid/shared';
import { type ChangeEventHandler, useEffect, useState } from 'react';
import { Field } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { passwordMismatch } from '@/lib/password-match';

interface NewPasswordFieldsProps {
  label?: string;
  value: string;
  autoFocus?: boolean;
  onChange: ChangeEventHandler<HTMLInputElement>;
}

export function NewPasswordFields({ label = 'Password', value, autoFocus, onChange }: NewPasswordFieldsProps) {
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (!value) {
      setConfirmation('');
    }
  }, [value]);

  return (
    <>
      <Field label={label} hint={`At least ${MIN_PASSWORD_LENGTH} characters`}>
        <PasswordInput
          value={value}
          required
          autoFocus={autoFocus}
          minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password"
          onChange={onChange}
        />
      </Field>
      <Field label="Confirm password">
        <PasswordInput
          value={confirmation}
          required
          autoComplete="new-password"
          validationMessage={passwordMismatch(value, confirmation)}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </Field>
    </>
  );
}
