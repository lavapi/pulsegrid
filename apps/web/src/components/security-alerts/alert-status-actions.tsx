'use client';

import { ALERT_STATUS_LABELS, type AlertStatus } from '@pulsegrid/shared';
import { useRefreshingAction } from '@/components/use-refreshing-action';
import { Button } from '@/components/ui/button';
import { apiSend } from '@/lib/browser-api';
import { NEXT_STATUSES } from '@/lib/security-alerts';

export function AlertStatusActions({ alertId, status }: { alertId: string; status: AlertStatus }) {
  const { pending, run } = useRefreshingAction();
  return (
    <div className="flex flex-wrap gap-2">
      {NEXT_STATUSES[status].map((next, index) => (
        <Button
          key={next.status}
          size="sm"
          variant={index === 0 ? 'primary' : 'secondary'}
          disabled={pending}
          onClick={() =>
            run(
              () => apiSend(`/security-alerts/${alertId}/status`, 'POST', { status: next.status }),
              `Alert marked ${ALERT_STATUS_LABELS[next.status].toLowerCase()}.`,
            )
          }
        >
          {next.label}
        </Button>
      ))}
    </div>
  );
}
