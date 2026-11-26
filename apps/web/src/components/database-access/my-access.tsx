'use client';

import type { DatabaseAccessConnect, DatabaseAccessGrant, DatabaseAccessRequest, MyDatabaseAccess } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { BrowserNotificationsButton } from '@/components/alerts/browser-notifications-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { LiveRefresh } from '@/components/ui/live-refresh';
import { Time } from '@/components/ui/time';
import { apiSendForJson } from '@/lib/browser-api';
import { progressOf } from '@/lib/database-access';
import { ConnectGuide } from './connect-guide';
import { RequestForm } from './request-form';

type ReadyAccess = Extract<MyDatabaseAccess, { ready: true }>;

const isOpen = (grant: DatabaseAccessGrant | null): grant is DatabaseAccessGrant =>
  grant?.status === 'granting' || grant?.status === 'active';

/** Why the last request didn't lead to access, shown above the form to ask again. */
const lastOutcome = (request: DatabaseAccessRequest | null, grant: DatabaseAccessGrant | null): string | null => {
  if (!request) return null;
  switch (request.status) {
    case 'declined':
      return `${request.decidedBy ?? 'An approver'} declined your last request${request.declineReason ? `: ${request.declineReason}` : '.'}`;
    case 'expired':
      return 'Your last request expired before anyone answered it.';
    case 'approved':
      return grant?.status === 'failed' ? `Your last request was approved, but AWS couldn't grant it: ${grant.failure}` : null;
    default:
      return null;
  }
};

function Waiting({ request }: { request: DatabaseAccessRequest }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const cancel = () =>
    startTransition(async () => {
      const { data, error } = await apiSendForJson(`/database-access/requests/${request.id}/cancel`, 'POST');
      if (!data) {
        toast.error(error ?? 'The request was not cancelled. Please try again.');
        return;
      }
      toast.success('Request cancelled');
      router.refresh();
    });

  return (
    <Card>
      <CardHeader
        title="Waiting for an approver"
        description="You'll get a sound and a notification here as soon as someone answers."
        action={<Badge tone="warning" dot>Waiting</Badge>}
      />
      <div className="flex flex-col gap-3 p-5 text-[13px]">
        <p>
          {request.hours} {request.hours === 1 ? 'hour' : 'hours'} for <strong>{request.userName}</strong>:{' '}
          {request.reason}
        </p>
        <p className="text-muted-foreground">
          Asked <Time value={request.createdAt} withZone />. It expires unanswered at{' '}
          <Time value={request.expiresAt} withZone />.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <BrowserNotificationsButton />
          <Button size="sm" variant="dangerGhost" disabled={pending} onClick={cancel}>
            Cancel request
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Access({ grant, connect }: { grant: DatabaseAccessGrant; connect: DatabaseAccessConnect | null }) {
  const progress = progressOf(grant);
  return (
    <Card>
      <CardHeader
        title="Your database access"
        description={`Read-only, for ${grant.userName}. It ends on its own.`}
        action={
          <Badge tone={grant.status === 'active' ? 'success' : 'warning'} dot>
            {grant.status === 'active' ? 'Active' : 'Granting'}
          </Badge>
        }
      />
      <div className="flex flex-col gap-3 p-5 text-[13px]">
        {progress ? (
          <p className="text-muted-foreground">{progress}</p>
        ) : (
          <p>
            Until <Time value={grant.expiresAt} withZone />, approved by {grant.grantedBy}.
          </p>
        )}
        {grant.status === 'active' && connect && (
          <div>
            <ConnectGuide grant={grant} connect={connect} trigger={<Button size="sm" variant="primary">How to connect</Button>} />
          </div>
        )}
      </div>
    </Card>
  );
}

export function MyAccess({ access }: { access: ReadyAccess }) {
  const { request, grant } = access;
  const outcome = lastOutcome(request, grant);
  return (
    <>
      <LiveRefresh active={request?.status === 'pending' || grant?.status === 'granting'} />
      {isOpen(grant) ? (
        <Access grant={grant} connect={access.connect} />
      ) : request?.status === 'pending' ? (
        <Waiting request={request} />
      ) : (
        <>
          {outcome && (
            <p className="text-[13px] text-muted-foreground" role="status">
              {outcome}
            </p>
          )}
          <RequestForm maxHours={access.maxHours} suggestedUserName={access.suggestedUserName} />
        </>
      )}
    </>
  );
}
