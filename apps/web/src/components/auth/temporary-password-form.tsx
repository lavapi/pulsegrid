'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NewPasswordFields } from './new-password-fields';
import { useAuthAction } from './use-auth-action';

export function TemporaryPasswordForm() {
  const { pending, post } = useAuthAction();
  const [newPassword, setNewPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    post('/account/password/temporary', { newPassword }, () => window.location.assign('/'));
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <NewPasswordFields
        label="New password"
        value={newPassword}
        autoFocus
        onChange={(event) => setNewPassword(event.target.value)}
      />
      <Button variant="primary" className="w-full" disabled={pending}>
        Save password
      </Button>
    </form>
  );
}
