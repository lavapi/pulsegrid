import type { ProductionRelease } from '@pulsegrid/shared';
import { Rocket } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Time } from '@/components/ui/time';
import { decisionText, isWaiting, releaseStatus } from '@/lib/production-releases';
import { DecisionButtons } from './decision-buttons';
import { HoldCountdown } from './hold-countdown';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function CurrentRelease({ release }: { release: ProductionRelease | null }) {
  if (!release) {
    return <EmptyState icon={Rocket} title="No release in progress" description="Production is on its current versions." />;
  }
  const status = releaseStatus(release.status);
  const decided = decisionText(release);
  return (
    <div className="flex flex-col gap-3">
      {isWaiting(release) && (
        <section
          className="flex flex-col gap-3 rounded-xl border border-warning bg-warning-soft p-5 sm:flex-row sm:items-center"
          aria-label="Decision needed"
        >
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Live on new versions, waiting for a decision</p>
            {release.holdUntil && (
              <p className="text-sm">
                <HoldCountdown until={release.holdUntil} />
              </p>
            )}
          </div>
          <DecisionButtons release={release} />
        </section>
      )}
      <Card>
        <CardHeader title={`Release ${release.id}`} action={<Badge tone={status.tone} dot>{status.label}</Badge>} />
        <dl className="flex flex-col gap-3 p-5 text-[13px]">
          {decided && <Row label="Decision">{decided}</Row>}
          <Row label="Components">
            <ul className="flex flex-col gap-0.5 font-mono text-xs">
              {release.components.map(({ name, tag }) => (
                <li key={name}>
                  {name} <span className="text-muted-foreground">→</span> {tag}
                </li>
              ))}
            </ul>
          </Row>
          <Row label="Requested by">{release.requestedBy ?? '—'}</Row>
          <Row label="Started">{release.createdAt ? <Time value={release.createdAt} /> : '—'}</Row>
          {release.holdUntil && (
            <Row label="Rolls back by itself at">
              <Time value={release.holdUntil} />
            </Row>
          )}
          {release.snapshot && <Row label="Database snapshot">{release.snapshot}</Row>}
        </dl>
      </Card>
    </div>
  );
}
