'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { useSyncProgress } from '@/components/sync/sync-progress-provider';
import { Button } from '@/components/ui/button';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend } from '@/lib/browser-api';
import { isAccountSyncing } from '@/lib/sync-progress';

const useAction = () => {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (request: () => Promise<string | null>, success?: string) => {
    startTransition(async () => {
      const failure = await request();
      if (failure) {
        toast.error(failure);
        return;
      }
      if (success) {
        toast.success(success);
      }
      router.refresh();
    });
  };

  return { pending, run };
};

export function TestConnectionButton({ accountId }: { accountId: string }) {
  const { pending, run } = useAction();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() => run(() => apiSend(`/cloud/accounts/${accountId}/test`, 'POST'))}
    >
      {pending ? 'Testing' : 'Test connection'}
    </Button>
  );
}

export function SyncNowButton({ accountId }: { accountId: string }) {
  const { syncs, follow } = useSyncProgress();
  const [pending, startTransition] = useTransition();
  const syncing = pending || isAccountSyncing(syncs, accountId);

  const start = () => {
    startTransition(async () => {
      const failure = await apiSend(`/cloud/accounts/${accountId}/sync`, 'POST');
      if (failure) {
        toast.error(failure);
        return;
      }
      await follow();
    });
  };

  return (
    <Button size="sm" disabled={syncing} onClick={start}>
      <RefreshCw className={syncing ? 'animate-spin' : undefined} />
      {syncing ? 'Syncing…' : 'Sync now'}
    </Button>
  );
}

export function RemoveAccountButton({ accountId, name }: { accountId: string; name: string }) {
  const { pending, run } = useAction();
  return (
    <ConfirmButton
      label="Remove"
      title={`Remove ${name}?`}
      description="This removes the account and its inventory from the dashboard. Nothing changes in your cloud account."
      confirmLabel="Remove account"
      disabled={pending}
      onConfirm={() => run(() => apiSend(`/cloud/accounts/${accountId}`, 'DELETE'), 'Account removed')}
    />
  );
}
