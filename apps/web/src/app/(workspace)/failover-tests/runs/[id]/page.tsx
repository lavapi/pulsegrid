import { type ExperimentRunDetail, type ExperimentRunItemState, isActiveExperiment } from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StopRunButton } from '@/components/experiments/experiment-buttons';
import { StateBadge } from '@/components/experiments/experiment-parts';
import { LiveRefresh } from '@/components/pipelines/live-refresh';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Time } from '@/components/ui/time';
import { getAccountContext } from '@/lib/account-context';
import { experimentPath } from '@/lib/experiments';
import { apiGet } from '@/lib/server-api';

const isRunning = ({ state }: ExperimentRunItemState): boolean => state !== null && isActiveExperiment(state);

function RunItem({ item }: { item: ExperimentRunItemState }) {
  const heading = (
    <span className="flex flex-col">
      <span className="font-medium">{item.label}</span>
      <span className="text-[13px] text-muted-foreground">
        {item.experimentId ?? item.templateId} · {item.region}
      </span>
      {item.error && <span className="text-[13px] text-danger">{item.error}</span>}
    </span>
  );
  const status = item.error ? (
    <Badge tone="danger" dot>
      Didn't start
    </Badge>
  ) : item.state ? (
    <StateBadge state={item.state} />
  ) : (
    <Badge>Unknown</Badge>
  );
  const row = 'flex flex-wrap items-center justify-between gap-3 px-5 py-3';
  return item.experimentId ? (
    <Link href={experimentPath(item.region, item.experimentId)} className={`${row} hover:bg-muted`}>
      {heading}
      {status}
    </Link>
  ) : (
    <div className={row}>
      {heading}
      {status}
    </div>
  );
}

export default async function ExperimentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { selected } = await getAccountContext();
  if (!selected) {
    redirect('/failover-tests');
  }
  const run = await apiGet<ExperimentRunDetail>(
    `/cloud/accounts/${selected.id}/experiment-runs/${encodeURIComponent(id)}`,
  );
  const active = run.items.some(isRunning);

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
        title={run.label}
        description={`${run.items.length} templates`}
        action={active && run.access.canRun && <StopRunButton accountId={selected.id} runId={run.id} />}
      />
      <p className="text-[13px] text-muted-foreground">
        Started <Time value={run.startedAt} />
        {run.startedBy && ` by ${run.startedBy}`}
      </p>
      {run.error && <p className="text-sm text-danger">{run.error}</p>}
      <Card>
        <ul className="divide-y">
          {run.items.map((item) => (
            <li key={`${item.region}/${item.templateId}`}>
              <RunItem item={item} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
