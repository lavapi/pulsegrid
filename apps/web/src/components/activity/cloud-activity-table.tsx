import type { CloudActivityEvent } from '@pulsegrid/shared';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Time } from '@/components/ui/time';

export function CloudActivityTable({ events }: { events: CloudActivityEvent[] }) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">Time</th>
              <th className="px-5 py-2.5 font-medium">Who</th>
              <th className="px-5 py-2.5 font-medium">What</th>
              <th className="px-5 py-2.5 font-medium">Resource</th>
              <th className="px-5 py-2.5 font-medium">Result</th>
              <th className="px-5 py-2.5 font-medium">IP address</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr className="border-b last:border-0" key={event.id}>
                <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                  <Time value={event.occurredAt} />
                </td>
                <td className="px-5 py-3">
                  {event.viaDashboard ? 'This dashboard' : event.actor}
                </td>
                <td className="whitespace-nowrap px-5 py-3 font-medium">{event.label}</td>
                <td className="break-all px-5 py-3 text-muted-foreground">{event.resource ?? '—'}</td>
                <td className="px-5 py-3">
                  <Badge tone={event.errorCode ? 'danger' : 'success'}>
                    {event.errorCode ? 'Failed' : 'Succeeded'}
                  </Badge>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{event.sourceIp ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
