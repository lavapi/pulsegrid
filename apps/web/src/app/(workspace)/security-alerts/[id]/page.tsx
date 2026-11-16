import { ALERT_SOURCE_LABELS, ALERT_STATUS_LABELS, hasPermission, type SecurityAlertDetail } from '@pulsegrid/shared';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AlertStatusActions } from '@/components/security-alerts/alert-status-actions';
import { SeverityBadge, StatusBadge } from '@/components/security-alerts/alert-badges';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { LiveRefresh } from '@/components/ui/live-refresh';
import { PageHeader } from '@/components/ui/page-header';
import { Time } from '@/components/ui/time';
import { accountLabel, alertFacts } from '@/lib/security-alerts';
import { apiGetOptional, getCurrentUser } from '@/lib/server-api';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[180px_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line break-words">{children}</dd>
    </div>
  );
}

export default async function SecurityAlertPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'security.view')) {
    redirect('/');
  }
  const { id } = await params;
  const alert = await apiGetOptional<SecurityAlertDetail>(`/security-alerts/${encodeURIComponent(id)}`);
  if (!alert) {
    notFound();
  }
  const rawEvent = JSON.stringify(alert.rawEvent, null, 2);

  return (
    <>
      <PageHeader
        title={alert.title}
        description={`${ALERT_SOURCE_LABELS[alert.source]} · ${accountLabel(alert)}${alert.region ? ` · ${alert.region}` : ''}`}
        leading={
          <Button asChild variant="ghost" size="icon" aria-label="Back to security alerts">
            <Link href="/security-alerts">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        }
        action={
          hasPermission(user, 'security.manage') ? <AlertStatusActions alertId={alert.id} status={alert.status} /> : null
        }
      />
      <LiveRefresh active={false} />
      <Card>
        <CardHeader title="Details" />
        <dl className="flex flex-col gap-3 p-5 text-[13px]">
          <Fact label="Severity">
            <SeverityBadge severity={alert.severity} />
          </Fact>
          <Fact label="Status">
            <span className="flex flex-wrap items-center gap-2">
              <StatusBadge status={alert.status} />
              {alert.statusChangedBy && alert.statusChangedAt && (
                <span className="text-muted-foreground">
                  by {alert.statusChangedBy}, <Time value={alert.statusChangedAt} />
                </span>
              )}
            </span>
          </Fact>
          <Fact label="Happened">
            <Time value={alert.occurredAt} />
          </Fact>
          <Fact label="Last received">
            <Time value={alert.lastSeenAt} />
          </Fact>
          {alertFacts(alert.facts).map(({ label, value }) => (
            <Fact label={label} key={label}>
              {value}
            </Fact>
          ))}
          {alert.consoleUrl && (
            <Fact label="AWS console">
              <a
                className="inline-flex items-center gap-1 font-medium hover:underline"
                href={alert.consoleUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in AWS <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </Fact>
          )}
        </dl>
      </Card>
      {alert.history.length > 0 && (
        <Card>
          <CardHeader title="Status history" />
          <ul className="flex flex-col gap-2 p-5 text-[13px]">
            {alert.history.map((change) => (
              <li key={change.changedAt}>
                <Time value={change.changedAt} /> · {change.changedBy} changed it from{' '}
                {ALERT_STATUS_LABELS[change.from]} to {ALERT_STATUS_LABELS[change.to]}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader title="Event from AWS" action={<CopyButton value={rawEvent} label="Copy JSON" showLabel />} />
        <pre className="max-h-[480px] overflow-auto p-5 font-mono text-xs leading-relaxed">{rawEvent}</pre>
      </Card>
    </>
  );
}
