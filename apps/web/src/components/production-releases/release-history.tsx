import type { ProductionRelease } from '@pulsegrid/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Time } from '@/components/ui/time';
import { decisionText, releaseStatus } from '@/lib/production-releases';

export function ReleaseHistory({ releases }: { releases: ProductionRelease[] }) {
  return (
    <Card>
      <CardHeader title="Recent releases" description="The last 20, newest first" />
      <div className="overflow-x-auto">
        <table className="min-w-full text-[13px]">
          <thead>
            <tr className="border-y text-left text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">Release</th>
              <th className="px-5 py-2.5 font-medium">Started</th>
              <th className="px-5 py-2.5 font-medium">Components</th>
              <th className="px-5 py-2.5 font-medium">Requested by</th>
              <th className="px-5 py-2.5 font-medium">Result</th>
              <th className="px-5 py-2.5 font-medium">Decision</th>
            </tr>
          </thead>
          <tbody>
            {releases.map((release) => {
              const status = releaseStatus(release.status);
              return (
                <tr className="border-b last:border-0" key={release.id}>
                  <td className="whitespace-nowrap px-5 py-3 font-medium">{release.id}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                    {release.createdAt ? <Time value={release.createdAt} /> : '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs">
                    {release.components.map(({ name, tag }) => `${name} ${tag}`).join(', ') || '—'}
                  </td>
                  <td className="px-5 py-3">{release.requestedBy ?? '—'}</td>
                  <td className="px-5 py-3">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{decisionText(release) ?? 'None'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
