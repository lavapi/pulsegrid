'use client';

import { SETUP_CODE_EXPIRED } from '@pulsegrid/shared';
import { type FormEvent, useState } from 'react';
import { NewPasswordFields } from '@/components/auth/new-password-fields';
import { useAuthAction } from '@/components/auth/use-auth-action';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { SetupSteps } from './setup-steps';

const TITLES = ['Enter your setup code', 'Name your first project', 'Create the super admin'];
const HINTS = [
  "It's in the server logs. It proves you run this server.",
  'Usually the product or team it covers. You can add more projects later.',
  'This person is the super admin: they see every project and manage people.',
];

export function SetupWizard() {
  const { pending, post } = useAuthAction();
  const [step, setStep] = useState(0);
  const [values, setValues] = useState({ code: '', company: '', name: '', email: '', password: '' });
  const change = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues({ ...values, [key]: event.target.value });

  const askForNewCode = (message: string) => {
    if (message === SETUP_CODE_EXPIRED) {
      setValues({ ...values, code: '' });
      setStep(0);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (step === 0) {
      post('/auth/setup/check', { code: values.code }, () => setStep(1), askForNewCode);
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    post('/auth/setup', values, () => window.location.assign('/setup-two-factor?install=1'), askForNewCode);
  };

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <div className="flex w-full max-w-md flex-col gap-6">
        <SetupSteps current={step} />
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">{TITLES[step]}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{HINTS[step]}</p>
        </div>
        <form className="flex flex-col gap-4 rounded-xl border bg-card p-5" onSubmit={submit}>
          {step === 0 && (
            <Field label="Setup code">
              <Input
                value={values.code}
                required
                autoFocus
                autoComplete="off"
                spellCheck={false}
                onChange={change('code')}
              />
            </Field>
          )}
          {step === 1 && (
            <Field label="Project name">
              <Input
                value={values.company}
                required
                autoFocus
                autoComplete="organization"
                onChange={change('company')}
              />
            </Field>
          )}
          {step === 2 && (
            <>
              <Field label="Your name">
                <Input value={values.name} required autoFocus autoComplete="name" onChange={change('name')} />
              </Field>
              <Field label="Email">
                <Input type="email" value={values.email} required autoComplete="email" onChange={change('email')} />
              </Field>
              <NewPasswordFields value={values.password} onChange={change('password')} />
              <p className="rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning" role="note">
                Keep this password and your backup codes safe. They can't be recovered, and losing them means
                reinstalling the app.
              </p>
            </>
          )}
          <div className="flex gap-2">
            {step > 0 && (
              <Button type="button" disabled={pending} onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            <Button variant="primary" className="flex-1" disabled={pending}>
              {step === 2 ? 'Create super admin' : 'Continue'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
