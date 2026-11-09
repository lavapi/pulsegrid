import type { CloudAccount, CloudActivityPage } from '@pulsegrid/shared';
import { History } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { apiGet } from '@/lib/server-api';
import { CloudActivityTable } from './cloud-activity-table';

const FILTERS = ['before', 'actor', 'action', 'resource', 'reads'] as const;

export type CloudActivityParams = Partial<Record<(typeof FILTERS)[number], string>>;

const activityQuery = (params: CloudActivityParams): URLSearchParams => {
  const query = new URLSearchParams();
  FILTERS.forEach((name) => {
    const value = params[name];
    if (value) {
      query.set(name, value);
    }
  });
  return query;
};

export function CloudActivityFilters({ params }: { params: CloudActivityParams }) {
  return (
    <form className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5" action="/activity">
      <input type="hidden" name="view" value="aws" />
      <Field label="Person">
        <Input name="actor" defaultValue={params.actor} />
      </Field>
      <Field label="Action">
        <Input name="action" defaultValue={params.action} placeholder="RebootInstances" />
      </Field>
      <Field label="Resource">
        <Input name="resource" defaultValue={params.resource} />
      </Field>
      <label className="flex h-9 items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          name="reads"
          value="true"
          className="size-4 accent-primary"
          defaultChecked={params.reads === 'true'}
        />
        Include read-only calls
      </label>
      <Button type="submit">Apply</Button>
    </form>
  );
}

export async function CloudActivitySection({
  account,
  params,
}: {
  account: CloudAccount;
  params: CloudActivityParams;
}) {
  const { events, before, error } = await apiGet<CloudActivityPage>(
    `/cloud/accounts/${account.id}/activity?${activityQuery(params)}`,
  );
  if (error) {
    return <p className="text-sm text-danger">{error}</p>;
  }
  const older = activityQuery({ ...params, before: before ?? undefined });
  older.set('view', 'aws');
  return (
    <>
      {events.length > 0 ? (
        <CloudActivityTable events={events} />
      ) : (
        <EmptyState icon={History} title="No AWS activity found" description="Try different filters." />
      )}
      {before && (
        <Button asChild className="w-fit">
          <Link href={`/activity?${older}`}>Older events</Link>
        </Button>
      )}
    </>
  );
}
