'use client';

import type { AccountSettings } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { apiSend } from '@/lib/browser-api';
import { NewPasswordFields } from './new-password-fields';

function PasswordCard({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const failure = await apiSend('/account/password', 'PUT', { currentPassword, newPassword });
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Password saved. Your other devices were signed out.');
      setCurrentPassword('');
      setNewPassword('');
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader title={hasPassword ? 'Change password' : 'Set a password'} />
      <form className="flex max-w-sm flex-col gap-4 p-5" onSubmit={submit}>
        {hasPassword && (
          <Field label="Current password">
            <PasswordInput
              value={currentPassword}
              required
              autoComplete="current-password"
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
        )}
        <NewPasswordFields
          label="New password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <Button variant="primary" className="w-fit" disabled={pending}>
          Save password
        </Button>
      </form>
    </Card>
  );
}

function TwoFactorCard({ backupCodesLeft }: { backupCodesLeft: number }) {
  return (
    <Card>
      <CardHeader
        title="Two-factor authentication"
        description={`Required for everyone. ${backupCodesLeft} backup codes left.`}
        action={
          <Badge tone="success" dot>
            On
          </Badge>
        }
      />
    </Card>
  );
}

export function AccountSettingsPanel({ settings }: { settings: AccountSettings }) {
  const [pending, startTransition] = useTransition();

  const signOutOthers = () => {
    startTransition(async () => {
      const failure = await apiSend('/account/sign-out-others', 'POST');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Your other devices were signed out');
    });
  };

  return (
    <>
      <PasswordCard hasPassword={settings.hasPassword} />
      <TwoFactorCard backupCodesLeft={settings.backupCodesLeft} />
      <Card>
        <CardHeader title="Devices" description="End every session except this one." />
        <div className="p-5">
          <Button disabled={pending} onClick={signOutOthers}>
            Sign out other devices
          </Button>
        </div>
      </Card>
    </>
  );
}
