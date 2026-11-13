import type { DatabaseAccessGrant } from '@pulsegrid/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { Time } from '@/components/ui/time';
import { endingOf } from '@/lib/database-access';

export function GrantHistory({ grants }: { grants: DatabaseAccessGrant[] }) {
  return (
    <Card className="overflow-x-auto">
      <CardHeader title="History" description="The last 100 grants that ended or failed." />
      {grants.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">No grants have ended yet.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-faint">
            <tr>
              {['Person', 'Granted by', 'Reason', 'Started', 'Ended', 'How it ended'].map((title) => (
                <th key={title} className="whitespace-nowrap px-3 py-2 font-semibold first:pl-5 last:pr-5">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => (
              <tr key={grant.id} className="border-t align-top">
                <td className="break-all py-2 pl-5 pr-3">{grant.userName}</td>
                <td className="px-3 py-2">{grant.grantedBy}</td>
                <td className="max-w-64 px-3 py-2">{grant.reason}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  <Time value={grant.startsAt} />
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {grant.status === 'failed' ? '—' : <Time value={grant.revokedAt ?? grant.expiresAt} />}
                </td>
                <td className={grant.status === 'failed' ? 'py-2 pl-3 pr-5 text-danger' : 'py-2 pl-3 pr-5'}>
                  {endingOf(grant)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
