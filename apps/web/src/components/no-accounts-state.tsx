import { hasPermission } from '@pulsegrid/shared';
import { Cloud } from 'lucide-react';
import Link from 'next/link';
import { CardGridSkeleton } from '@/components/skeletons';
import { SyncProgressCards } from '@/components/sync/sync-progress-card';
import { WhileSyncing } from '@/components/sync/while-syncing';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getCurrentUser } from '@/lib/server-api';

export async function NoAccountsState() {
  const user = await getCurrentUser();
  const canConnect = hasPermission(user, 'integrations.manage');

  return (
    <>
      <PageHeader title="Connect a cloud account" description="See your accounts and services here." />
      <SyncProgressCards />
      <WhileSyncing loading={<CardGridSkeleton />}>
        <EmptyState
          icon={Cloud}
          title="No cloud accounts yet"
          description={
            canConnect
              ? 'Add a cloud integration to start reading your infrastructure.'
              : 'An admin needs to add a cloud account first.'
          }
          action={
            canConnect && (
              <Button asChild variant="primary">
                <Link href="/settings/integrations">Add a cloud account</Link>
              </Button>
            )
          }
        />
      </WhileSyncing>
    </>
  );
}
