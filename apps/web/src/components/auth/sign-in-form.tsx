'use client';

import type { SignInResult } from '@pulsegrid/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { GoogleButton, OrDivider } from './google-button';
import { useAuthAction } from './use-auth-action';

const goHome = () => window.location.assign('/');

function TwoFactorForm({ challenge }: { challenge: string }) {
  const { pending, post } = useAuthAction();
  const [code, setCode] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    post('/auth/two-factor', { challenge, code }, goHome);
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <Field label="Authentication code" hint="From your authenticator app, or a backup code">
        <Input
          value={code}
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode="text"
          onChange={(event) => setCode(event.target.value)}
        />
      </Field>
      <Button variant="primary" className="w-full" disabled={pending}>
        Verify
      </Button>
    </form>
  );
}

export function SignInForm({
  google,
  initialChallenge,
}: {
  google: boolean;
  initialChallenge: string | null;
}) {
  const { pending, post } = useAuthAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState(initialChallenge);

  if (challenge) {
    return <TwoFactorForm challenge={challenge} />;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    post<SignInResult>('/auth/sign-in', { email, password }, ({ twoFactorChallenge }) => {
      if (twoFactorChallenge) {
        setChallenge(twoFactorChallenge);
      } else {
        goHome();
      }
    });
  };

  return (
    <>
      {google && (
        <>
          <GoogleButton />
          <OrDivider />
        </>
      )}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Email">
          <Input
            type="email"
            value={email}
            required
            autoFocus
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label="Password">
          <PasswordInput
            value={password}
            required
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button variant="primary" className="w-full" disabled={pending}>
          Sign in
        </Button>
      </form>
    </>
  );
}
