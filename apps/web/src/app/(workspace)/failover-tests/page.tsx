import { type ExperimentsView, type ExperimentTemplate, RUN_ALL_LABEL } from '@pulsegrid/shared';
import { FlaskConical, History } from 'lucide-react';
import Link from 'next/link';
import { RunExperimentsButton, StartExperimentButton } from '@/components/experiments/experiment-buttons';
import { ExperimentGroups, RecentRuns } from '@/components/experiments/experiment-groups';
import { StateBadge, StepSummary, StopAlarms, TargetList } from '@/components/experiments/experiment-parts';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Time } from '@/components/ui/time';
import { getAccountContext } from '@/lib/account-context';
import { experimentPath, HISTORY_PATH } from '@/lib/experiments';
import { apiGet } from '@/lib/server-api';

function TemplateCard({
  accountId,
  template,
  canRun,
}: {
  accountId: string;
  template: ExperimentTemplate;
  canRun: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title={template.label}
        description={`${template.id} · ${template.region}`}
        action={canRun && <StartExperimentButton accountId={accountId} template={template} />}
      />
      <div className="flex flex-col gap-4 p-5">
        {template.description && template.description !== template.label && (
          <p className="text-sm">{template.description}</p>
        )}
        <section className="flex flex-col gap-1.5" aria-label="Targets">
          <h3 className="text-xs font-semibold text-faint">Targets</h3>
          <TargetList targets={template.targets} />
        </section>
        <section className="flex flex-col gap-1.5" aria-label="Steps">
          <h3 className="text-xs font-semibold text-faint">Steps</h3>
          <ul className="flex flex-col gap-2 text-[13px]">
            {template.steps.map((step) => (
              <li key={step.name}>
                <StepSummary step={step} />
              </li>
            ))}
          </ul>
        </section>
        <StopAlarms alarms={template.stopAlarms} />
      </div>
    </Card>
  );
}

export default async function ExperimentsPage() {
  const { selected } = await getAccountContext();
  if (!selected) {
    return (
      <>
        <PageHeader title="Failover tests" />
        <EmptyState
          icon={FlaskConical}
          title="No cloud account yet"
          description="Connect an AWS account under Integrations to run its failover tests here."
        />
      </>
    );
  }
  const view = await apiGet<ExperimentsView>(`/cloud/accounts/${selected.id}/experiments`);

  return (
    <>
      <PageHeader
        title="Failover tests"
        description={`Failover test templates in ${selected.name}, from AWS FIS. Templates are made in AWS; run and watch them here.`}
        action={
          <div className="flex items-center gap-2">
            <Button asChild size="sm">
              <Link href={HISTORY_PATH}>
                <History aria-hidden="true" />
                Test history
              </Link>
            </Button>
            {view.access.canRun && view.templates.length > 0 && (
              <RunExperimentsButton
                accountId={selected.id}
                label={RUN_ALL_LABEL}
                templateLabels={view.templates.map(({ label }) => label)}
                triggerLabel="Run all"
              />
            )}
          </div>
        }
      />
      {view.access.blockedReason && (
        <p className="rounded-lg bg-muted px-4 py-3 text-[13px] text-muted-foreground">
          {view.access.blockedReason}
        </p>
      )}
      {view.error && <p className="text-sm text-danger">{view.error}</p>}
      {!view.error && view.templates.length === 0 && (
        <EmptyState
          icon={FlaskConical}
          title="No failover test templates"
          description="Create a template in the AWS FIS console or with Terraform, then it shows up here."
        />
      )}
      {(view.templates.length > 0 || view.groups.length > 0) && (
        <ExperimentGroups accountId={selected.id} view={view} />
      )}
      {view.runs.length > 0 && <RecentRuns runs={view.runs} />}
      <div className="grid gap-4 xl:grid-cols-2">
        {view.templates.map((template) => (
          <TemplateCard
            key={`${template.region}/${template.id}`}
            accountId={selected.id}
            template={template}
            canRun={view.access.canRun}
          />
        ))}
      </div>
      {view.experiments.length > 0 && (
        <Card>
          <CardHeader title="Recent tests" description="Started here or anywhere else in AWS." />
          <ul className="divide-y">
            {view.experiments.map((experiment) => (
              <li key={`${experiment.region}/${experiment.id}`}>
                <Link
                  href={experimentPath(experiment.region, experiment.id)}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-muted"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{experiment.label}</span>
                    <span className="text-[13px] text-muted-foreground">
                      {experiment.id} · {experiment.region}
                      {experiment.startedAt && (
                        <>
                          {' · '}
                          <Time value={experiment.startedAt} />
                        </>
                      )}
                    </span>
                  </span>
                  <StateBadge state={experiment.state} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
