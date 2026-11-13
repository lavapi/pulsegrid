'use client';

import type { DatabaseAccessConnect, DatabaseAccessGrant, OutsideDatabaseAccess } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { Badge } from '@/components/ui/badge';
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
import { Time } from '@/components/ui/time';
import { apiSendForJson } from '@/lib/browser-api';
import { progressOf, STATUS_LABELS, timeLeft } from '@/lib/database-access';
import { CodeField } from './code-field';
import { ConnectGuide } from './connect-guide';
import { HoursSelect } from './hours-select';

const TICK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function ChangeDialog({
  grant,
  kind,
  maxHours,
}: {
  grant: DatabaseAccessGrant;
  kind: 'extend' | 'revoke';
  maxHours: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [hours, setHours] = useState(1);
  const [code, setCode] = useState('');
  const extend = kind === 'extend';

  const submit = () =>
    startTransition(async () => {
      const { data, error } = await apiSendForJson<DatabaseAccessGrant>(
        `/database-access/grants/${grant.id}/${kind}`,
        'POST',
        extend ? { hours, code: code.trim() } : { code: code.trim() },
      );
      setCode('');
      if (!data) {
        toast.error(error ?? 'That did not work. Please try again.');
        return;
      }
      setOpen(false);
      toast.success(extend ? `Extending access for ${grant.userName}` : `Revoking access for ${grant.userName}`);
      router.refresh();
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={extend ? 'secondary' : 'danger'}>
          {extend ? 'Extend' : 'Revoke'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">
          {extend ? `Extend access for ${grant.userName}?` : `Revoke access for ${grant.userName}?`}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {extend
            ? `Access can last at most ${maxHours} hours from now.`
            : 'AWS removes their access and stops new sign-ins to the database.'}
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          {extend && <HoursSelect label="Add" value={hours} maxHours={maxHours} onChange={setHours} />}
          <CodeField value={code} onChange={setCode} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button>Cancel</Button>
          </DialogClose>
          <Button variant={extend ? 'primary' : 'danger'} disabled={pending || code.trim().length < 6} onClick={submit}>
            {extend ? 'Extend' : 'Revoke'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GrantRow({
  grant,
  maxHours,
  now,
  connect,
}: {
  grant: DatabaseAccessGrant;
  maxHours: number;
  now: number;
  connect: DatabaseAccessConnect | null;
}) {
  const left = timeLeft(grant.expiresAt, now);
  const progress = progressOf(grant);
  const changeable = grant.status === 'active' && !grant.change;
  return (
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5 text-[13px]">
          {grant.status === 'active' && connect ? (
            <ConnectGuide
              grant={grant}
              connect={connect}
              trigger={
                <button type="button" className="w-fit break-all text-left text-sm font-medium hover:underline">
                  {grant.userName}
                </button>
              }
            />
          ) : (
            <span className="break-all text-sm font-medium">{grant.userName}</span>
          )}
          <span className="text-muted-foreground">
            Granted by {grant.grantedBy} · {grant.reason}
          </span>
          <span className="text-muted-foreground">
            Ends <Time value={grant.expiresAt} withZone />
            {left && grant.status === 'active' && <strong className="text-foreground"> · {left} left</strong>}
          </span>
          {progress && <span>{progress}…</span>}
          {grant.failure && <span className="text-warning">{grant.failure}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={grant.status === 'active' ? 'success' : 'warning'}>{STATUS_LABELS[grant.status]}</Badge>
          {grant.status === 'active' && connect && (
            <ConnectGuide
              grant={grant}
              connect={connect}
              trigger={
                <Button size="sm" variant="ghost">
                  How to connect
                </Button>
              }
            />
          )}
          {changeable && (
            <>
              <ChangeDialog grant={grant} kind="extend" maxHours={maxHours} />
              <ChangeDialog grant={grant} kind="revoke" maxHours={maxHours} />
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function OutsideList({ items, checkedAt }: { items: OutsideDatabaseAccess[]; checkedAt: string | null }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="border-t px-5 py-4 text-[13px]">
      <strong className="text-warning">Granted outside PulseGrid</strong>
      <p className="text-muted-foreground">
        AWS has access for these Identity Center users that wasn&apos;t granted here. PulseGrid doesn&apos;t remove it.
        {checkedAt && (
          <>
            {' '}
            Checked <Time value={checkedAt} />.
          </>
        )}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {items.map(({ userId, expiresAt }) => (
          <li key={userId}>
            <code>{userId}</code>
            {expiresAt ? (
              <>
                {' '}
                · ends <Time value={expiresAt} withZone />
              </>
            ) : (
              ' · end time unknown'
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** People with access now, and grants or changes still running in AWS, refreshed until they finish. */
export function GrantList({
  grants,
  maxHours,
  connect,
  outside,
  outsideCheckedAt,
}: {
  grants: DatabaseAccessGrant[];
  maxHours: number;
  connect: DatabaseAccessConnect | null;
  outside: OutsideDatabaseAccess[];
  outsideCheckedAt: string | null;
}) {
  const now = useNow();
  const busy = grants.some(({ status, change }) => status !== 'active' || change !== null);
  return (
    <Card>
      <LiveRefresh active={busy} />
      <CardHeader title="Access now" description="Access ends on its own at the time shown." />
      {grants.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No one has access to the production database.</p>
      ) : (
        <ul className="divide-y">
          {grants.map((grant) => (
            <GrantRow key={grant.id} grant={grant} maxHours={maxHours} now={now} connect={connect} />
          ))}
        </ul>
      )}
      <OutsideList items={outside} checkedAt={outsideCheckedAt} />
    </Card>
  );
}
