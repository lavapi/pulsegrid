'use client';

import type { TwoFactorEnabled, TwoFactorSetup as Setup } from '@pulsegrid/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { Field, Input } from '@/components/ui/input';
import { useAuthAction } from './use-auth-action';

export function TwoFactorSetup({ onFinished }: { onFinished: () => void }) {
  const { pending, post } = useAuthAction();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  const started = useRef(false);

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      post<Setup>('/account/two-factor/start', {}, setSetup);
    }
  });

  if (backupCodes) {
    return (
      <>
        <p className="text-sm">
          Save these backup codes somewhere safe. Each one works once if you lose your phone, and
          you won&apos;t see them again.
        </p>
        <pre className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-3 text-[13px]">
          {backupCodes.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </pre>
        <CopyButton value={backupCodes.join('\n')} label="Copy backup codes" />
        <Button variant="primary" className="w-full" onClick={onFinished}>
          I&apos;ve saved them
        </Button>
      </>
    );
  }

  const confirm = (event: FormEvent) => {
    event.preventDefault();
    post<TwoFactorEnabled>('/account/two-factor/confirm', { code }, ({ backupCodes: codes }) =>
      setBackupCodes(codes),
    );
  };

  return (
    <>
      <p className="text-sm">Scan this code with an authenticator app, then enter the 6-digit code.</p>
      {setup && (
        <>
          <img src={setup.qrCode} alt="Authenticator setup code" className="mx-auto rounded-lg bg-white p-2" width={180} height={180} />
          <p className="break-all text-center text-xs text-muted-foreground">
            Or enter this key: <code>{setup.secret}</code>
          </p>
        </>
      )}
      <form className="flex flex-col gap-4" onSubmit={confirm}>
        <Field label="Code">
          <Input
            value={code}
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Button variant="primary" className="w-full" disabled={pending || !setup}>
          Turn on two-factor
        </Button>
      </form>
    </>
  );
}
