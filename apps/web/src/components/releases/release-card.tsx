import type { Release } from '@pulsegrid/shared';
import Link from 'next/link';
import { DomainIcon, ExternalDomainLink } from '@/components/domain-links';
import { RelativeTime } from '@/components/pipelines/relative-time';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { domainLinkLabel } from '@/lib/domains';
import { appPath, runPath } from '@/lib/pipelines';
import { RELEASE_STATES } from '@/lib/releases';
import { RemoveLinkButton } from './remove-link-button';
import { StageLine } from './stage-line';

const TIME_MATCH_HINT = 'Matched by time. Put the commit in the image tag for an exact match.';

function RunSummary({ release: { pipelineName, run } }: { release: Release }) {
  if (!run) {
    return <>{pipelineName}</>;
  }
  return (
    <>
      {[run.branch, run.commit, run.title, run.actor && `by ${run.actor}`].filter(Boolean).join(' · ')}
    </>
  );
}

export function ReleaseCard({ release, canManage }: { release: Release; canManage: boolean }) {
  const { appId, appName, serviceName, environmentName, run, state, stages } = release;
  const { readyAt, matchedBy, issue, servicePath, appDomains } = release;
  const view = RELEASE_STATES[state];
  return (
    <Card className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={appPath(appId)} className="text-[15px] font-semibold hover:underline">
          {appName}
        </Link>
        <span className="text-[13px] text-muted-foreground">to {serviceName}</span>
        {environmentName && <Badge>{environmentName}</Badge>}
        <Badge tone={view.tone} className="ml-auto">
          {view.label}
        </Badge>
      </div>
      <p className="mt-1 mb-3 truncate text-xs text-muted-foreground">
        <RunSummary release={release} />
      </p>
      <StageLine stages={stages} />
      {issue && <p className="mt-3 text-[13px] text-danger">{issue}</p>}
      {matchedBy === 'time' && <p className="mt-3 text-xs text-muted-foreground">{TIME_MATCH_HINT}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {readyAt && (
          <span>
            Ready <RelativeTime value={readyAt} />
          </span>
        )}
        {!readyAt && run?.startedAt && (
          <span>
            Started <RelativeTime value={run.startedAt} />
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-4">
          {state === 'ready' &&
            appDomains.map((domain) => (
              <ExternalDomainLink
                key={domain.id}
                domain={domain}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <DomainIcon kind={domain.kind} className="size-3.5" />
                {domainLinkLabel(domain)}
              </ExternalDomainLink>
            ))}
          {run && (
            <Link href={runPath(appId, run.id)} className="hover:text-foreground hover:underline">
              View run
            </Link>
          )}
          {servicePath && (
            <Link href={servicePath} className="hover:text-foreground hover:underline">
              View service
            </Link>
          )}
          {canManage && <RemoveLinkButton release={release} />}
        </span>
      </div>
    </Card>
  );
}
