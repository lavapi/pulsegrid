import {
  type ActionRun,
  type AuditEventPage,
  categoryOf,
  type CloudActivityPage,
  type Resource,
  type ResourceActionOption,
  resourceTypeLabel,
  hasPermission,
  type SecretView,
  SERVICE_CATEGORIES,
} from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, Suspense } from 'react';
import { ActivityTable } from '@/components/activity/activity-table';
import { CloudActivityTable } from '@/components/activity/cloud-activity-table';
import { HealthBadge } from '@/components/health-badge';
import { ResourceActionPanel } from '@/components/infrastructure/resource-action-panel';
import { SecretPanel } from '@/components/infrastructure/secret-panel';
import { ServiceLogs } from '@/components/infrastructure/service-logs';
import { ServiceIcon } from '@/components/service-icon';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { PageHeader } from '@/components/ui/page-header';
import { Time } from '@/components/ui/time';
import { formatValue, humanizeKey } from '@/lib/format';
import { apiGet, getCurrentUser } from '@/lib/server-api';
import { formatDeployment, formatLaunchType } from '@/lib/service-views';

function Fields({ entries }: { entries: [string, ReactNode][] }) {
  return (
    <dl className="divide-y">
      {entries.map(([label, value]) => (
        <div className="grid gap-1 px-5 py-2.5 sm:grid-cols-[200px_minmax(0,1fr)]" key={label}>
          <dt className="text-[13px] text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-[13px]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

const DETAIL_FORMATTERS: Record<string, (value: unknown) => string> = {
  launchType: formatLaunchType,
  rolloutState: formatDeployment,
};

const RECENT_ACTIVITY = 5;

const MAP_ONLY_DETAILS = ['allowedFrom', 'targetGroups', 'targetInstances'];

const TIME_DETAILS = ['lastChangedAt'];

const detailValue = (key: string, value: unknown): ReactNode =>
  TIME_DETAILS.includes(key) && typeof value === 'string' ? (
    <Time value={value} withZone />
  ) : (
    (DETAIL_FORMATTERS[key] ?? formatValue)(value)
  );

const lookupName = (nativeId: string): string => nativeId.split(/[/:]/).at(-1) ?? nativeId;

async function RecentAwsActivity({ accountId, nativeId }: { accountId: string; nativeId: string }) {
  const { events } = await apiGet<CloudActivityPage>(
    `/cloud/accounts/${accountId}/activity?resource=${encodeURIComponent(lookupName(nativeId))}`,
  );
  const recent = events.slice(0, RECENT_ACTIVITY);
  return (
    recent.length > 0 && (
      <section className="flex flex-col gap-2" aria-label="Recent AWS activity">
        <h2 className="text-sm font-semibold">Recent AWS activity</h2>
        <CloudActivityTable events={recent} />
      </section>
    )
  );
}

export default async function ResourceDetailPage({
  params,
}: {
  params: Promise<{ category: string; id: string }>;
}) {
  const { id } = await params;
  const path = `/resources/${encodeURIComponent(id)}`;
  const [resource, actions, run, user] = await Promise.all([
    apiGet<Resource>(path),
    apiGet<ResourceActionOption[]>(`${path}/actions`),
    apiGet<ActionRun | null>(`${path}/actions/runs/latest`),
    getCurrentUser(),
  ]);
  const activity = hasPermission(user, 'activity.view')
    ? await apiGet<AuditEventPage>(`/audit-events?resource=${resource.id}&limit=${RECENT_ACTIVITY}`)
    : null;
  const category = categoryOf(resource.type);
  const secret =
    resource.type === 'secrets-manager-secret' ? await apiGet<SecretView>(`${path}/secret`) : null;

  const summary: [string, ReactNode][] = [
    ['Type', resourceTypeLabel(resource.type)],
    ['Account', `${resource.cloudAccount.name} (${resource.cloudAccount.accountId})`],
    ['Region', resource.region],
    [
      'ID',
      <span className="flex items-center gap-1" key="id">
        <code className="min-w-0 break-all">{resource.nativeId}</code>
        <CopyButton value={resource.nativeId} label="Copy ID" />
      </span>,
    ],
    ['Last seen', <Time value={resource.lastSeenAt} withZone key="seen" />],
  ];
  const details = Object.entries(resource.details)
    .filter(
      ([key, value]) => value !== null && value !== undefined && !MAP_ONLY_DETAILS.includes(key),
    )
    .map(([key, value]): [string, ReactNode] => [humanizeKey(key), detailValue(key, value)]);
  const tags = Object.entries(resource.tags);

  return (
    <>
      <Link
        href={`/infrastructure/${category}`}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        {SERVICE_CATEGORIES[category].label}
      </Link>
      <PageHeader
        leading={<ServiceIcon category={category} size={48} />}
        title={resource.name}
        action={<HealthBadge health={resource.health} status={resource.status} />}
      />
      <ResourceActionPanel
        key={resource.id}
        resourceId={resource.id}
        resourceName={resource.name}
        actions={actions}
        initialRun={run}
      />
      {secret && <SecretPanel resourceId={resource.id} view={secret} />}
      {resource.type === 'ecs-service' && <ServiceLogs resourceId={resource.id} />}
      <Card>
        <CardHeader title="Summary" />
        <Fields entries={summary} />
      </Card>
      {details.length > 0 && (
        <Card>
          <CardHeader title="Details" />
          <Fields entries={details} />
        </Card>
      )}
      {tags.length > 0 && (
        <Card>
          <CardHeader title="Tags" />
          <Fields entries={tags} />
        </Card>
      )}
      {activity && (
        <Suspense fallback={null}>
          <RecentAwsActivity accountId={resource.cloudAccount.id} nativeId={resource.nativeId} />
        </Suspense>
      )}
      {activity && activity.events.length > 0 && (
        <section className="flex flex-col gap-2" aria-label="Recent activity">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          <ActivityTable events={activity.events} />
        </section>
      )}
    </>
  );
}
