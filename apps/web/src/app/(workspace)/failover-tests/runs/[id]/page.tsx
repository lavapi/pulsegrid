import { type CurrentUser, type ExperimentRunDetail, type ExperimentRunItemState, hasPermission } from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StopRunButton } from '@/components/experiments/experiment-buttons';
import { Fact, ResultBadge, StateBadge } from '@/components/experiments/experiment-parts';
import { DeleteReportButton, DownloadPdfButton } from '@/components/experiments/report-buttons';
import { ReportLoads, RunTimeline, type TimelineRow } from '@/components/experiments/report-parts';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Time } from '@/components/ui/time';
import { getAccountContext } from '@/lib/account-context';
import { experimentPath, formatDuration, HISTORY_PATH, pdfFileName, reportPath, reportWindow } from '@/lib/experiments';
import { apiGet, getCurrentUser } from '@/lib/server-api';

const RESULT_NOTES = {
  passed: 'Every test completed.',
  failed: "At least one test failed or didn't start.",
  stopped: 'At least one test was stopped before it finished, or cancelled before it started.',
  unknown: 'AWS no longer has the result of at least one test.',
  running: 'Tests are still running.',
} as const;

const timelineRow = (item: ExperimentRunItemState): TimelineRow => ({
  key: `${item.region}/${item.templateId}`,
  label: item.label,
  result: item.report?.result ?? 'running',
  startedAt: item.report?.startedAt ?? null,
  endedAt: item.report?.endedAt ?? null,
  steps: item.report?.steps ?? [],
});

function ItemStatus({ item }: { item: ExperimentRunItemState }) {
  if (item.skipped) {
    return <Badge tone="neutral">Skipped</Badge>;
  }
  if (item.waiting) {
    return <Badge tone="neutral">Waiting</Badge>;
  }
  if (item.cancelled) {
    return <Badge tone="neutral">Cancelled</Badge>;
  }
  if (item.error) {
    return (
      <Badge tone="danger" dot>
        Didn&apos;t start
      </Badge>
    );
  }
  if (item.report) {
    return <ResultBadge result={item.report.result} />;
  }
  return item.state ? <StateBadge state={item.state} /> : <Badge>Unknown</Badge>;
}

const itemLink = (item: ExperimentRunItemState): string | null => {
  if (item.report) {
    return reportPath(item.report.id);
  }
  return item.experimentId ? experimentPath(item.region, item.experimentId) : null;
};

function ItemRow({ item }: { item: ExperimentRunItemState }) {
  const link = itemLink(item);
  const reason =
    item.skipped ??
    item.error ??
    item.report?.reason ??
    item.note ??
    (item.waiting ? 'Starts after the test before it, once the environment is healthy.' : item.cancelled ? 'Stop all cancelled it before it started.' : null);
  const startedAt = item.report?.startedAt ?? item.startedAt ?? null;
  const endedAt = item.report?.endedAt ?? item.endedAt ?? null;
  const repairs = item.repairs ?? [];
  return (
    <tr className="border-t align-top">
      <td className="px-5 py-3">
        {link ? (
          <Link href={link} className="font-medium hover:underline">
            {item.label}
          </Link>
        ) : (
          <span className="font-medium">{item.label}</span>
        )}
        <div className="text-[12px] text-muted-foreground">
          {item.experimentId ?? item.templateId} · {item.region}
          {item.zoneWide && ' · zone-wide, runs alone at the end'}
        </div>
        {reason && <div className="text-[12px] text-muted-foreground">{reason}</div>}
      </td>
      <td className="px-5 py-3">
        <ItemStatus item={item} />
      </td>
      <td className="whitespace-nowrap px-5 py-3">{startedAt ? <Time value={startedAt} /> : '—'}</td>
      <td className="whitespace-nowrap px-5 py-3">{endedAt ? <Time value={endedAt} /> : '—'}</td>
      <td className="whitespace-nowrap px-5 py-3">{formatDuration(startedAt, endedAt) ?? '—'}</td>
      <td className="whitespace-nowrap px-5 py-3">
        {formatDuration(endedAt, item.healthyAt ?? null) ?? (item.settling && endedAt ? 'Checking…' : '—')}
      </td>
      <td className="px-5 py-3">
        {repairs.length === 0
          ? '—'
          : repairs.map(({ at, text }) => (
              <div key={`${at}-${text}`} className={at ? undefined : 'text-danger'}>
                {text}
                {at && (
                  <>
                    {' '}
                    at <Time value={at} />
                  </>
                )}
              </div>
            ))}
      </td>
    </tr>
  );
}

const canManage = (user: CurrentUser) => hasPermission(user, 'environments.manage');

export default async function ExperimentRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ account?: string }>;
}) {
  const [{ id }, { account }] = await Promise.all([params, searchParams]);
  const { selected } = await getAccountContext();
  const accountId = account ?? selected?.id;
  if (!accountId) {
    redirect('/failover-tests');
  }
  const [run, user] = await Promise.all([
    apiGet<ExperimentRunDetail>(
      `/cloud/accounts/${encodeURIComponent(accountId)}/experiment-runs/${encodeURIComponent(id)}`,
    ),
    getCurrentUser(),
  ]);
  const running = run.result === 'running';
  const ended = run.items.filter(({ report }) => report);
  const waiting = run.items.filter((item) => item.waiting).length;

  return (
    <>
      <LiveRefresh active={running} />
      <Link
        href={HISTORY_PATH}
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Test history
      </Link>
      <PageHeader
        title={run.label}
        description={`Failover test run · ${run.items.length} tests`}
        action={
          <div className="flex items-center gap-2">
            <ResultBadge result={run.result} />
            {running && run.access.canRun && <StopRunButton accountId={accountId} runId={run.id} />}
            {!running && (
              <DownloadPdfButton
                path={`/experiment-reports/runs/${run.id}/pdf?account=${encodeURIComponent(accountId)}`}
                fileName={pdfFileName(run.label, run.startedAt)}
              />
            )}
            {!running && canManage(user) && (
              <DeleteReportButton path={`/experiment-reports/runs/${run.id}`} label={run.label} />
            )}
          </div>
        }
      />
      {run.error && <p className="text-sm text-danger">{run.error}</p>}
      {run.stoppedReason && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-[13px] text-danger">
          The run stopped: {run.stoppedReason}
        </p>
      )}
      <Card>
        <dl className="grid gap-4 p-5 text-[13px] sm:grid-cols-2 lg:grid-cols-3 [&_dd]:break-words">
          <Fact label="Environment">{run.environmentName ?? 'None'}</Fact>
          <Fact label="Account">{run.accountName}</Fact>
          <Fact label="Started by">{run.startedBy ?? '—'}</Fact>
          <Fact label="Started">
            <Time value={run.startedAt} withZone />
          </Fact>
          <Fact label="Ended">{run.endedAt ? <Time value={run.endedAt} withZone /> : '—'}</Fact>
          <Fact label="Duration">{formatDuration(run.startedAt, run.endedAt) ?? '—'}</Fact>
        </dl>
        <p className="border-t px-5 py-3 text-[13px] text-muted-foreground">
          {ended.length} of {run.items.length} tests have ended
          {waiting > 0 && `, ${waiting} waiting`}. {RESULT_NOTES[run.result]}
        </p>
      </Card>
      <Card className="overflow-x-auto">
        <CardHeader title="Tests" description="Every test in this run, with why each one ended." />
        <table className="w-full text-[13px]">
          <thead className="text-left text-[12px] text-faint">
            <tr>
              <th className="px-5 py-2 font-semibold">Test</th>
              <th className="px-5 py-2 font-semibold">Result</th>
              <th className="px-5 py-2 font-semibold">Started</th>
              <th className="px-5 py-2 font-semibold">Ended</th>
              <th className="px-5 py-2 font-semibold">Duration</th>
              <th className="px-5 py-2 font-semibold">Healthy again after</th>
              <th className="px-5 py-2 font-semibold">Repairs</th>
            </tr>
          </thead>
          <tbody>
            {run.items.map((item) => (
              <ItemRow key={`${item.region}/${item.templateId}`} item={item} />
            ))}
          </tbody>
        </table>
      </Card>
      <RunTimeline rows={ended.map(timelineRow)} />
      <ReportLoads resources={run.resources} timeWindow={reportWindow(run.startedAt, run.endedAt)} />
    </>
  );
}
