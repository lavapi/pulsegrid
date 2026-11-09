import {
  CLOUD_SERVICES,
  type EnvironmentSummary,
  isActivePipelineStatus,
  type PipelineSummary,
  RESOURCE_TYPES,
} from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { QuickLinks } from '@/components/domain-links';
import { HealthSummaryBadge } from '@/components/health-badge';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { PipelineTable } from '@/components/pipelines/pipeline-table';
import { ResourceTable } from '@/components/resource-table';
import { HealthTiles } from '@/components/service-summary';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Time } from '@/components/ui/time';
import { byHealthThenName } from '@/lib/health';
import { loadResources } from '@/lib/resources';
import { apiGet } from '@/lib/server-api';

const isRunning = (run: PipelineSummary['latestRun']): boolean =>
  run !== null && isActivePipelineStatus(run.status);

export default async function EnvironmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const environment = await apiGet<EnvironmentSummary>(`/environments/${encodeURIComponent(id)}`);
  const resources = await loadResources(new URLSearchParams({ environment: id }));
  const pipelines = await apiGet<PipelineSummary[]>(`/pipelines/environment/${encodeURIComponent(id)}`);
  const attention = resources.filter(({ health }) => health === 'degraded');
  const services = Object.keys(CLOUD_SERVICES) as (keyof typeof CLOUD_SERVICES)[];

  return (
    <>
      <Link
        href="/environments"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Environments
      </Link>
      <PageHeader
        title={environment.name}
        description={
          environment.lastSyncedAt ? (
            <>
              Last synced <Time value={environment.lastSyncedAt} withZone />
            </>
          ) : (
            'Not synced yet'
          )
        }
        action={<HealthSummaryBadge health={environment.health} />}
      />
      {environment.domains.length > 0 && <QuickLinks domains={environment.domains} />}
      <HealthTiles health={environment.health} serviceCount={environment.services.length} />
      {pipelines.length > 0 && (
        <Card>
          <LiveRefresh active={pipelines.some(({ latestRun }) => isRunning(latestRun))} />
          <CardHeader title={`Pipelines (${pipelines.length})`} />
          <PipelineTable pipelines={pipelines} />
        </Card>
      )}
      {attention.length > 0 && (
        <Card className="border-danger/40">
          <CardHeader title="Needs attention" />
          <ResourceTable resources={attention.sort(byHealthThenName)} columnSet="summary" showAccount />
        </Card>
      )}
      {services.map((service) => {
        const items = resources
          .filter((resource) => RESOURCE_TYPES[resource.type].service === service)
          .sort(byHealthThenName);
        return (
          items.length > 0 && (
            <Card key={service}>
              <CardHeader title={`${CLOUD_SERVICES[service]} (${items.length})`} />
              <ResourceTable resources={items} columnSet="summary" showAccount />
            </Card>
          )
        );
      })}
    </>
  );
}
