'use client';

import type { DatabaseAccessRequest } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { BrowserNotificationsButton } from '@/components/alerts/browser-notifications-button';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/input';
import { Time } from '@/components/ui/time';
import { apiSendForJson } from '@/lib/browser-api';
import { CodeField } from './code-field';
import { HoursSelect } from './hours-select';

type Answer = 'approve' | 'decline';

function AnswerDialog({
  request,
  answer,
  maxHours,
}: {
  request: DatabaseAccessRequest;
  answer: Answer;
  maxHours: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [hours, setHours] = useState(request.hours);
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const approve = answer === 'approve';

  const submit = () =>
    startTransition(async () => {
      const { data, error } = await apiSendForJson<DatabaseAccessRequest>(
        `/database-access/requests/${request.id}/${answer}`,
        'POST',
        approve ? { hours, code: code.trim() } : { reason: reason.trim() || null },
      );
      setCode('');
      if (!data) {
        toast.error(error ?? 'That did not work. Please try again.');
        router.refresh();
        return;
      }
      setOpen(false);
      toast.success(approve ? `Granting access to ${request.userName}` : `Declined ${request.requestedBy}'s request`);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={approve ? 'primary' : 'dangerGhost'}>
          {approve ? 'Approve' : 'Decline'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">
          {approve ? `Approve access for ${request.userName}?` : `Decline ${request.requestedBy}'s request?`}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {approve
            ? 'They get read-only access to the production database, ending on its own.'
            : 'They see your reason and can ask again.'}
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          {approve ? (
            <>
              <HoursSelect label="For" value={hours} maxHours={maxHours} onChange={setHours} />
              <CodeField value={code} onChange={setCode} />
            </>
          ) : (
            <Field label="Reason, optional">
              <Textarea rows={2} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
            </Field>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button
            variant={approve ? 'danger' : 'primary'}
            disabled={pending || (approve && code.trim().length < 6)}
            onClick={submit}
          >
            {approve ? 'Approve' : 'Decline'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Requests from people who can't grant access themselves, oldest first. */
export function RequestList({ requests, maxHours }: { requests: DatabaseAccessRequest[]; maxHours: number }) {
  return (
    <Card>
      <CardHeader
        title="Requests"
        description="People asking for access. You get a sound and a notification for each new one."
        action={<BrowserNotificationsButton />}
      />
      {requests.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No one is waiting for access.</p>
      ) : (
        <ul className="divide-y">
          {requests.map((request) => (
            <li key={request.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
              <div className="flex min-w-0 flex-col gap-0.5 text-[13px]">
                <span className="font-medium">
                  {request.requestedBy} · {request.hours} {request.hours === 1 ? 'hour' : 'hours'}
                </span>
                <span className="text-muted-foreground">
                  {request.userName} · asked <Time value={request.createdAt} withZone />
                </span>
                <span className="break-words">{request.reason}</span>
              </div>
              <div className="flex gap-2">
                <AnswerDialog request={request} answer="decline" maxHours={maxHours} />
                <AnswerDialog request={request} answer="approve" maxHours={maxHours} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
