import { type ExperimentReport, hasPermission, shownName } from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Fact, ResultBadge, StepSummary, StopAlarms, TargetList } from '@/components/experiments/experiment-parts';
import { DeleteReportButton, DownloadPdfButton } from '@/components/experiments/report-buttons';
import { ReportLoads, RunTimeline } from '@/components/experiments/report-parts';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Time } from '@/components/ui/time';
import { formatDuration, HISTORY_PATH, historyRunPath, pdfFileName, reportWindow } from '@/lib/experiments';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function ExperimentReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [report, user] = await Promise.all([
    apiGet<ExperimentReport>(`/experiment-reports/${encodeURIComponent(id)}`),
    getCurrentUser(),
  ]);

  return (
    <>
      <Link
        href={HISTORY_PATH}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Test history
      </Link>
      <PageHeader
        title={report.label}
        description={`Failover test report · ${report.experimentId} · ${report.region}`}
        action={
          <div className="flex items-center gap-2">
            <ResultBadge result={report.result} />
            <DownloadPdfButton
              path={`/experiment-reports/${report.id}/pdf`}
              fileName={pdfFileName(report.label, report.startedAt)}
            />
            {hasPermission(user, 'environments.manage') && (
              <DeleteReportButton path={`/experiment-reports/${report.id}`} label={report.label} />
            )}
          </div>
        }
      />
      {report.run && (
        <p className="text-[13px] text-muted-foreground print:hidden">
          Part of{' '}
          <Link className="font-medium text-foreground hover:underline" href={historyRunPath(report.run.id, report.accountId)}>
            {report.run.label}
          </Link>
          , where every test of the run is reported together.
        </p>
      )}
      <Card>
        <dl className="grid gap-4 p-5 text-[13px] sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Environment">{report.environmentName ?? 'None'}</Fact>
          <Fact label="Account">{report.accountName}</Fact>
          <Fact label="Started by">{report.startedBy ?? 'Outside PulseGrid'}</Fact>
          <Fact label="Started">{report.startedAt ? <Time value={report.startedAt} withZone /> : '—'}</Fact>
          <Fact label="Ended">{report.endedAt ? <Time value={report.endedAt} withZone /> : '—'}</Fact>
          <Fact label="Duration">{formatDuration(report.startedAt, report.endedAt) ?? '—'}</Fact>
        </dl>
        {report.reason && <p className="border-t px-5 py-3 text-[13px]">{report.reason}</p>}
      </Card>
      <RunTimeline
        rows={[
          {
            key: report.id,
            label: report.label,
            result: report.result,
            startedAt: report.startedAt,
            endedAt: report.endedAt,
            steps: report.steps,
          },
        ]}
      />
      <Card>
        <CardHeader title="What it did" description={report.description ?? undefined} />
        <div className="flex flex-col gap-4 p-5">
          <section className="flex flex-col gap-1.5" aria-label="Targets">
            <h3 className="text-xs font-semibold text-faint">Targets</h3>
            <TargetList targets={report.targets} />
          </section>
          <section className="flex flex-col gap-1.5" aria-label="Steps">
            <h3 className="text-xs font-semibold text-faint">Steps</h3>
            <ul className="flex flex-col gap-2 text-[13px]">
              {report.steps.map((step) => (
                <li key={step.name} className="flex flex-col gap-0.5">
                  <StepSummary step={step} />
                  {step.reason && <span className="text-muted-foreground">{step.reason}</span>}
                </li>
              ))}
            </ul>
          </section>
          <StopAlarms alarms={report.stopAlarms} />
        </div>
      </Card>
      {report.resources.length > 0 && (
        <Card>
          <CardHeader title="Affected resources" description="Resources this test picked that PulseGrid knows." />
          <ul className="divide-y text-[13px]">
            {report.resources.map((resource) => (
              <li key={resource.id} className="px-5 py-3">
                <Link href={resource.path} className="font-medium hover:underline">
                  {shownName(resource)}
                </Link>
                {resource.displayName && <span className="text-muted-foreground"> · {resource.name}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ReportLoads resources={report.resources} timeWindow={reportWindow(report.startedAt, report.endedAt)} />
    </>
  );
}
