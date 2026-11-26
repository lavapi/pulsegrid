'use client';

import type { SignInResult } from '@pulsegrid/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { GoogleButton, OrDivider } from './google-button';
import { useAuthAction } from './use-auth-action';

/** Where sign-in goes once it's done: home, or the page that asked, such as the iPhone app's hand-off. */
const goTo = (next: string) => () => window.location.assign(next);

function TwoFactorForm({ next }: { next: string }) {
  const { pending, post } = useAuthAction();
  const [code, setCode] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    post('/auth/two-factor', { code }, goTo(next));
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
  initialTwoFactor,
  next = '/',
}: {
  google: boolean;
  initialTwoFactor: boolean;
  next?: string;
}) {
  const { pending, post } = useAuthAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactor, setTwoFactor] = useState(initialTwoFactor);

  if (twoFactor) {
    return <TwoFactorForm next={next} />;
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    post<SignInResult>('/auth/sign-in', { email, password }, ({ twoFactorRequired }) => {
      if (twoFactorRequired) {
        setTwoFactor(true);
      } else {
        goTo(next)();
      }
    });
  };

  return (
    <>
      {google && (
        <>
          <GoogleButton next={next} />
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
