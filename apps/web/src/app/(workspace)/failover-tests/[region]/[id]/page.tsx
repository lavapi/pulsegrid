import { type ExperimentDetail, isActiveExperiment, shownName, supportsLoad } from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StopExperimentButton } from '@/components/experiments/experiment-buttons';
import { Fact, StateBadge, StepSummary, StopAlarms, TargetList } from '@/components/experiments/experiment-parts';
import { ResourceLoad } from '@/components/infrastructure/load/resource-load';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Time } from '@/components/ui/time';
import { getAccountContext } from '@/lib/account-context';
import { apiGet } from '@/lib/server-api';

const LOAD_LIMIT = 3;

export default async function ExperimentPage({ params }: { params: Promise<{ region: string; id: string }> }) {
  const { region, id } = await params;
  const { selected } = await getAccountContext();
  if (!selected) {
    redirect('/failover-tests');
  }
  const experiment = await apiGet<ExperimentDetail>(
    `/cloud/accounts/${selected.id}/experiments/${encodeURIComponent(region)}/${encodeURIComponent(id)}`,
  );
  const active = isActiveExperiment(experiment.state);
  const withLoad = experiment.resources.filter(({ type }) => supportsLoad(type)).slice(0, LOAD_LIMIT);

  return (
    <>
      <LiveRefresh active={active} />
      <Link
        href="/failover-tests"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Failover tests
      </Link>
      <PageHeader
        title={experiment.label}
        description={`${experiment.id} · ${experiment.region}`}
        action={
          <div className="flex items-center gap-2">
            <StateBadge state={experiment.state} />
            {active && experiment.access.canRun && (
              <StopExperimentButton accountId={selected.id} region={experiment.region} id={experiment.id} />
            )}
          </div>
        }
      />
      {active && experiment.access.blockedReason && (
        <p className="rounded-lg bg-muted px-4 py-3 text-[13px] text-muted-foreground">
          {experiment.access.blockedReason} To stop it, use the AWS FIS console.
        </p>
      )}
      <Card>
        <CardHeader title="Summary" />
        <dl className="flex flex-wrap gap-x-10 gap-y-3 p-5 text-[13px]">
          <Fact label="Started">{experiment.startedAt ? <Time value={experiment.startedAt} withZone /> : '—'}</Fact>
          <Fact label="Ended">{experiment.endedAt ? <Time value={experiment.endedAt} withZone /> : '—'}</Fact>
          <Fact label="Started by">{experiment.startedBy ?? 'Outside PulseGrid'}</Fact>
          {experiment.reason && <Fact label="Reason">{experiment.reason}</Fact>}
        </dl>
        <div className="flex flex-col gap-3 border-t p-5">
          <StopAlarms alarms={experiment.stopAlarms} />
          <TargetList targets={experiment.targets} />
        </div>
      </Card>
      <Card>
        <CardHeader title="Steps" />
        <ul className="divide-y">
          {experiment.steps.map((step) => (
            <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-[13px]" key={step.name}>
              <span className="flex flex-col gap-0.5">
                <StepSummary step={step} />
                {step.reason && <span className="text-muted-foreground">{step.reason}</span>}
                {step.startedAt && (
                  <span className="text-faint">
                    <Time value={step.startedAt} />
                    {step.endedAt && (
                      <>
                        {' – '}
                        <Time value={step.endedAt} />
                      </>
                    )}
                  </span>
                )}
              </span>
              <StateBadge state={step.state} />
            </li>
          ))}
        </ul>
      </Card>
      {experiment.resources.length > 0 && (
        <Card>
          <CardHeader title="Affected resources" description="Resources this test picked that PulseGrid knows." />
          <ul className="divide-y">
            {experiment.resources.map((resource) => (
              <li key={resource.id}>
                <Link href={resource.path} className="block px-5 py-3 text-[13px] hover:bg-muted">
                  <span className="font-medium">{shownName(resource)}</span>
                  <span className="text-muted-foreground"> · {resource.type}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {withLoad.map((resource) => (
        <section className="flex flex-col gap-2" key={resource.id} aria-label={`Load of ${shownName(resource)}`}>
          <h2 className="text-sm font-semibold">Load of {shownName(resource)}</h2>
          <ResourceLoad resourceId={resource.id} />
        </section>
      ))}
    </>
  );
}
