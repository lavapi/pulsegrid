'use client';

import type { TemporaryPassword } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { apiSendForJson } from '@/lib/browser-api';
import { TemporaryPasswordDialog } from './temporary-password-dialog';

const EMPTY_PERSON = { firstName: '', lastName: '', email: '' };

export function AddPersonForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState(EMPTY_PERSON);
  const [created, setCreated] = useState<TemporaryPassword | null>(null);
  const [personName, setPersonName] = useState('');
  const change = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues({ ...values, [key]: event.target.value });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const { data, error } = await apiSendForJson<TemporaryPassword>('/people', 'POST', values);
      if (error) {
        toast.error(error);
        return;
      }
      setPersonName(`${values.firstName} ${values.lastName}`.trim());
      setCreated(data);
      setValues(EMPTY_PERSON);
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader title="Add person" description="They can sign in once you assign them to a project." />
      <form className="grid gap-3 p-5 sm:grid-cols-3" onSubmit={submit}>
        <Field label="First name">
          <Input value={values.firstName} required autoComplete="off" onChange={change('firstName')} />
        </Field>
        <Field label="Last name">
          <Input value={values.lastName} required autoComplete="off" onChange={change('lastName')} />
        </Field>
        <Field label="Email">
          <Input type="email" value={values.email} required autoComplete="off" onChange={change('email')} />
        </Field>
        <Button variant="primary" className="w-fit sm:col-span-3" disabled={pending}>
          Add person
        </Button>
      </form>
      <TemporaryPasswordDialog created={created} memberName={personName} onClose={() => setCreated(null)} />
    </Card>
  );
}
