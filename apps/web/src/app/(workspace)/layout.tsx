import type { ProjectList } from '@pulsegrid/shared';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { SyncProgressProvider } from '@/components/sync/sync-progress-provider';
import { getAccountContext } from '@/lib/account-context';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (user.mustChangePassword) {
    redirect('/change-password');
  }
  if (!user.twoFactorEnabled) {
    redirect('/setup-two-factor');
  }
  if (!user.tenant) {
    redirect('/no-project');
  }
  const [{ accounts, selected }, { projects }] = await Promise.all([
    getAccountContext(),
    apiGet<ProjectList>('/projects'),
  ]);

  return (
    <AppShell
      user={user}
      projects={projects}
      accounts={accounts}
      selectedId={selected?.id ?? null}
    >
      <SyncProgressProvider>{children}</SyncProgressProvider>
    </AppShell>
  );
}
