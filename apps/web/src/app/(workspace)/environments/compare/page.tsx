import {
  type ComparisonRow,
  type EnvironmentComparison,
  type EnvironmentSummary,
  resourcePath,
  resourceTypeLabel,
} from '@pulsegrid/shared';
import { ArrowLeft, ArrowRight, ChevronDown, GitCompareArrows } from 'lucide-react';
import Link from 'next/link';
import { HealthBadge } from '@/components/health-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Dropdown } from '@/components/ui/dropdown';
import { Field } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { StatTile } from '@/components/ui/stat-tile';
import { humanizeKey } from '@/lib/format';
import { apiGet } from '@/lib/server-api';

const defaultPair = (environments: EnvironmentSummary[]): [string?, string?] => {
  const named = (name: string) => environments.find((item) => item.name === name)?.id;
  return [
    named('Staging') ?? environments[0]?.id,
    named('Production') ?? environments.at(-1)?.id,
  ];
};

function Side({ row, side }: { row: ComparisonRow; side: 'left' | 'right' }) {
  const resource = row[side];
  if (!resource) {
    return <Badge tone="danger">Missing</Badge>;
  }
  return (
    <span className="flex flex-col items-start gap-1">
      <Link
        href={resourcePath({ id: resource.id, type: row.type })}
        className="max-w-[280px] truncate font-medium hover:text-primary"
      >
        {resource.name}
      </Link>
      <HealthBadge health={resource.health} status={resource.status} />
    </span>
  );
}

function RowsTable({
  rows,
  comparison,
}: {
  rows: ComparisonRow[];
  comparison: EnvironmentComparison;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-[13px]">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">{comparison.left.name}</th>
            <th className="px-4 py-2.5 font-medium">{comparison.right.name}</th>
            <th className="px-4 py-2.5 font-medium">Differences</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr className="border-b align-top last:border-0" key={`${row.type}-${row.key}-${index}`}>
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                {resourceTypeLabel(row.type)}
              </td>
              <td className="px-4 py-3">
                <Side row={row} side="left" />
              </td>
              <td className="px-4 py-3">
                <Side row={row} side="right" />
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-col gap-1">
                  {row.differences.map(({ field, left, right }) => (
                    <span className="flex flex-wrap items-center gap-1.5" key={field}>
                      <span className="text-muted-foreground">{humanizeKey(field)}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5">{left}</code>
                      <ArrowRight className="size-3 text-faint" aria-hidden="true" />
                      <code className="rounded bg-warning-soft px-1.5 py-0.5 text-warning">
                        {right}
                      </code>
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Picker({
  environments,
  left,
  right,
}: {
  environments: EnvironmentSummary[];
  left?: string | undefined;
  right?: string | undefined;
}) {
  const options = environments.map(({ id, name }) => ({ value: id, label: name }));
  return (
    <form className="flex flex-wrap items-end gap-3" action="/environments/compare">
      <Field label="Compare" className="min-w-44 flex-1 sm:max-w-60" labelsOwnControl>
        <Dropdown name="left" label="Compare" defaultValue={left ?? ''} options={options} />
      </Field>
      <Field label="With" className="min-w-44 flex-1 sm:max-w-60" labelsOwnControl>
        <Dropdown name="right" label="With" defaultValue={right ?? ''} options={options} />
      </Field>
      <Button>Compare</Button>
    </form>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ left?: string; right?: string }>;
}) {
  const query = await searchParams;
  const environments = await apiGet<EnvironmentSummary[]>('/environments');
  const [defaultLeft, defaultRight] = defaultPair(environments);
  const left = query.left ?? defaultLeft;
  const right = query.right ?? defaultRight;

  const header = (
    <>
      <Link
        href="/environments"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Environments
      </Link>
      <PageHeader
        title="Compare environments"
        description="Matched by name, ignoring words like staging or prod. Networks aren't compared."
      />
    </>
  );

  if (!left || !right || environments.length < 2) {
    return (
      <>
        {header}
        <EmptyState
          icon={GitCompareArrows}
          title="You need two environments"
          description="Comparing needs access to at least two environments."
        />
      </>
    );
  }

  const params = new URLSearchParams({ left, right });
  const comparison = await apiGet<EnvironmentComparison>(`/environments/compare?${params}`);
  const missing = comparison.rows.filter(({ state }) => state.startsWith('only_'));
  const different = comparison.rows.filter(({ state }) => state === 'different');
  const same = comparison.rows.filter(({ state }) => state === 'same');

  return (
    <>
      {header}
      <Picker environments={environments} left={left} right={right} />
      <section className="grid grid-cols-3 gap-3" aria-label="Comparison summary">
        <StatTile label="Missing" value={missing.length} tone={missing.length ? 'danger' : 'default'} />
        <StatTile label="Different" value={different.length} tone={different.length ? 'warning' : 'default'} />
        <StatTile label="Matching" value={same.length} tone={same.length ? 'success' : 'default'} />
      </section>
      {missing.length > 0 && (
        <Card>
          <CardHeader title="Only in one environment" />
          <RowsTable rows={missing} comparison={comparison} />
        </Card>
      )}
      {different.length > 0 && (
        <Card>
          <CardHeader title="Configured differently" />
          <RowsTable rows={different} comparison={comparison} />
        </Card>
      )}
      {same.length > 0 && (
        <Card>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold">
              Matching resources ({same.length})
              <ChevronDown
                className="size-4 text-faint transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="border-t">
              <RowsTable rows={same} comparison={comparison} />
            </div>
          </details>
        </Card>
      )}
    </>
  );
}
