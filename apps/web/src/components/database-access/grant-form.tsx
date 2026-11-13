'use client';

import type { DatabaseAccessGrant } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { ProductionNotice } from '@/components/ui/production-notice';
import { apiSendForJson } from '@/lib/browser-api';
import { CodeField } from './code-field';
import { HoursSelect } from './hours-select';

/** Grants a person read-only access to the production database for a set time. */
export function GrantForm({ maxHours }: { maxHours: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userName, setUserName] = useState('');
  const [hours, setHours] = useState(1);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const ready = userName.trim().length > 0 && reason.trim().length > 0 && code.trim().length >= 6;

  const submit = () =>
    startTransition(async () => {
      const { data, error } = await apiSendForJson<DatabaseAccessGrant>('/database-access/grants', 'POST', {
        userName: userName.trim(),
        hours,
        reason: reason.trim(),
        code: code.trim(),
      });
      setCode('');
      if (!data) {
        toast.error(error ?? 'Access was not granted. Please try again.');
        return;
      }
      toast.success(`Granting access to ${data.userName}`);
      setUserName('');
      setReason('');
      router.refresh();
    });

  return (
    <Card>
      <CardHeader title="Grant access" description="Read-only access to the production database, ending on its own." />
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <ProductionNotice target="Production database" />
        <Field label="Identity Center user name, usually their email">
          <Input
            value={userName}
            autoComplete="off"
            maxLength={128}
            placeholder="pat@example.com"
            onChange={(event) => setUserName(event.target.value)}
          />
        </Field>
        <HoursSelect label="For" value={hours} maxHours={maxHours} onChange={setHours} />
        <Field label="Reason">
          <Textarea
            rows={2}
            maxLength={500}
            placeholder="What they need to look at"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <CodeField value={code} onChange={setCode} />
        <div>
          <Button type="submit" variant="danger" disabled={pending || !ready}>
            {pending ? 'Granting…' : 'Grant access'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
