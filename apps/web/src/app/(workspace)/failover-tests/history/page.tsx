import type { TestHistory, TestHistoryEntry } from '@pulsegrid/shared';
import { ArrowLeft, History } from 'lucide-react';
import Link from 'next/link';
import { ResultBadge } from '@/components/experiments/experiment-parts';
import { HistoryFilters } from '@/components/experiments/history-filters';
import { ExportHistoryButton } from '@/components/experiments/report-buttons';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { Time } from '@/components/ui/time';
import { formatDuration, historyRunPath, reportPath } from '@/lib/experiments';
import { apiGet } from '@/lib/server-api';

const FILTERS = ['environment', 'label', 'result', 'from', 'to'] as const;

const entryPath = (entry: TestHistoryEntry): string =>
  entry.kind === 'run' ? historyRunPath(entry.id, entry.accountId) : reportPath(entry.id);

const countsOf = ({ counts }: TestHistoryEntry): string | null => {
  if (!counts) {
    return null;
  }
  const parts = [
    `${counts.total} tests`,
    counts.passed && `${counts.passed} passed`,
    counts.stopped && `${counts.stopped} stopped`,
    counts.failed && `${counts.failed} failed`,
    counts.notStarted && `${counts.notStarted} didn't start`,
    counts.cancelled && `${counts.cancelled} cancelled`,
    counts.waiting && `${counts.waiting} waiting`,
  ];
  return parts.filter(Boolean).join(' · ');
};

export default async function TestHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams(
    FILTERS.flatMap((name) => (params[name] ? [[name, params[name]] as [string, string]] : [])),
  ).toString();
  const suffix = query ? `?${query}` : '';
  const history = await apiGet<TestHistory>(`/experiment-reports${suffix}`);

  return (
    <>
      <Link
        href="/failover-tests"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Failover tests
      </Link>
      <PageHeader
        title="Test history"
        description="Every failover test that has ended, in every account. Group runs and Run all show as one entry."
        action={<ExportHistoryButton query={suffix} />}
      />
      <HistoryFilters environments={history.environments} labels={history.labels} />
      {history.entries.length === 0 ? (
        <EmptyState
          icon={History}
          title="No test reports yet"
          description="A report is saved here when a failover test ends, including tests started in AWS."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-left text-[12px] text-faint">
              <tr>
                <th className="px-5 py-2 font-semibold">Test or run</th>
                <th className="px-5 py-2 font-semibold">Environment</th>
                <th className="px-5 py-2 font-semibold">Result</th>
                <th className="px-5 py-2 font-semibold">Started</th>
                <th className="px-5 py-2 font-semibold">Duration</th>
                <th className="px-5 py-2 font-semibold">Started by</th>
              </tr>
            </thead>
            <tbody>
              {history.entries.map((entry) => (
                <tr key={`${entry.kind}/${entry.id}`} className="border-t align-top hover:bg-muted">
                  <td className="px-5 py-3">
                    <Link href={entryPath(entry)} className="font-medium hover:underline">
                      {entry.label}
                    </Link>
                    <div className="text-[12px] text-muted-foreground">
                      {countsOf(entry) ?? 'Single test'} · {entry.accountName}
                    </div>
                  </td>
                  <td className="px-5 py-3">{entry.environmentName ?? 'None'}</td>
                  <td className="px-5 py-3">
                    <ResultBadge result={entry.result} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">{entry.startedAt ? <Time value={entry.startedAt} /> : '—'}</td>
                  <td className="whitespace-nowrap px-5 py-3">{formatDuration(entry.startedAt, entry.endedAt) ?? '—'}</td>
                  <td className="px-5 py-3">{entry.startedBy ?? 'Outside PulseGrid'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
