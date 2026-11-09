import { type EnvironmentAdminView, hasPermission } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import { EnvironmentManager } from '@/components/environment-manager';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function EnvironmentSettingsPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'environments.manage')) {
    redirect('/');
  }
  const view = await apiGet<EnvironmentAdminView>('/environments/manage');

  return (
    <>
      <PageHeader
        title="Manage environments"
        description="Group cloud accounts into environments, and add the app and Grafana domains for each one."
      />
      <EnvironmentManager view={view} />
    </>
  );
}
