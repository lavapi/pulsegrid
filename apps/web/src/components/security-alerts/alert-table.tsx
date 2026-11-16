import { ALERT_SOURCE_LABELS, type SecurityAlert } from '@pulsegrid/shared';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Time } from '@/components/ui/time';
import { accountLabel } from '@/lib/security-alerts';
import { SeverityBadge, StatusBadge } from './alert-badges';

export function AlertTable({ alerts }: { alerts: SecurityAlert[] }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">Time</th>
              <th className="px-5 py-2.5 font-medium">Severity</th>
              <th className="px-5 py-2.5 font-medium">Alert</th>
              <th className="px-5 py-2.5 font-medium">Account</th>
              <th className="px-5 py-2.5 font-medium">Region</th>
              <th className="px-5 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((alert) => (
              <tr className="border-b last:border-0" key={alert.id}>
                <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                  <Time value={alert.occurredAt} />
                </td>
                <td className="px-5 py-3">
                  <SeverityBadge severity={alert.severity} />
                </td>
                <td className="px-5 py-3">
                  <Link className="font-medium hover:underline" href={`/security-alerts/${alert.id}`}>
                    {alert.title}
                  </Link>
                  <span className="block text-muted-foreground">{ALERT_SOURCE_LABELS[alert.source]}</span>
                </td>
                <td className="whitespace-nowrap px-5 py-3">{accountLabel(alert)}</td>
                <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{alert.region ?? '—'}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={alert.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
