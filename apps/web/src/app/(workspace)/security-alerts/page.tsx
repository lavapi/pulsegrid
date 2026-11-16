import { hasPermission, type SecurityAlertFilterOptions, type SecurityAlertPage } from '@pulsegrid/shared';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AlertFilters } from '@/components/security-alerts/alert-filters';
import { AlertTable } from '@/components/security-alerts/alert-table';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { alertQuery } from '@/lib/security-alerts';
import { apiGet, getCurrentUser } from '@/lib/server-api';

type AlertParams = Record<string, string | undefined>;

export default async function SecurityAlertsPage({ searchParams }: { searchParams: Promise<AlertParams> }) {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'security.view')) {
    redirect('/');
  }
  const params = await searchParams;
  const [{ alerts, nextCursor }, options] = await Promise.all([
    apiGet<SecurityAlertPage>(`/security-alerts?${alertQuery(params)}`),
    apiGet<SecurityAlertFilterOptions>('/security-alerts/options'),
  ]);
  const older = new URLSearchParams(Object.entries(params).flatMap(([key, value]) => (value ? [[key, value]] : [])));
  older.set('cursor', nextCursor ?? '');

  return (
    <>
      <PageHeader title="Security alerts" description="GuardDuty, Security Hub and root activity across the AWS organization" />
      <AlertFilters
        accounts={options.accounts.map(({ id, name }) => ({ value: id, label: name ? `${name} (${id})` : id }))}
        regions={options.regions.map((region) => ({ value: region, label: region }))}
      />
      {alerts.length > 0 ? (
        <AlertTable alerts={alerts} />
      ) : (
        <EmptyState icon={ShieldAlert} title="No alerts found" description="Nothing matches these filters." />
      )}
      {nextCursor && (
        <Button asChild className="w-fit">
          <Link href={`/security-alerts?${older}`}>Older alerts</Link>
        </Button>
      )}
    </>
  );
}
