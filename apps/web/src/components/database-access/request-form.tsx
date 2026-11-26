'use client';

import type { DatabaseAccessRequest } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { apiSendForJson } from '@/lib/browser-api';
import { HoursSelect } from './hours-select';

/** Asks an approver for read-only access to the production database. */
export function RequestForm({ maxHours, suggestedUserName }: { maxHours: number; suggestedUserName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [userName, setUserName] = useState(suggestedUserName);
  const [hours, setHours] = useState(1);
  const [reason, setReason] = useState('');
  const ready = userName.trim().length > 0 && reason.trim().length > 0;

  const submit = () =>
    startTransition(async () => {
      const { data, error } = await apiSendForJson<DatabaseAccessRequest>('/database-access/requests', 'POST', {
        userName: userName.trim(),
        hours,
        reason: reason.trim(),
      });
      if (!data) {
        toast.error(error ?? 'Your request was not sent. Please try again.');
        return;
      }
      toast.success('Request sent. Approvers are notified now.');
      setReason('');
      router.refresh();
    });

  return (
    <Card>
      <CardHeader
        title="Request access"
        description="Read-only access to the production database, ending on its own. An approver answers it."
      />
      <form
        className="flex max-w-lg flex-col gap-4 p-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Your Identity Center user name, usually your email">
          <Input
            value={userName}
            autoComplete="off"
            maxLength={128}
            onChange={(event) => setUserName(event.target.value)}
          />
        </Field>
        <HoursSelect label="For" value={hours} maxHours={maxHours} onChange={setHours} />
        <Field label="Reason">
          <Textarea
            rows={2}
            maxLength={500}
            placeholder="What you need to look at"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={pending || !ready}>
            {pending ? 'Sending…' : 'Request access'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
