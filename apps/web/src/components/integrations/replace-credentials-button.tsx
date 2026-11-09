'use client';

import type { CredentialField } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/pipelines/action-dialog';
import { useSyncProgress } from '@/components/sync/sync-progress-provider';
import { Button } from '@/components/ui/button';
import { apiSend } from '@/lib/browser-api';
import { CredentialFields, type CredentialValues, isComplete } from './credential-fields';

interface ReplaceCredentialsButtonProps {
  path: string;
  name: string;
  fields: readonly CredentialField[];
}

export function ReplaceCredentialsButton({ path, name, fields }: ReplaceCredentialsButtonProps) {
  const router = useRouter();
  const { follow } = useSyncProgress();
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<CredentialValues>({});

  const replace = () => {
    startTransition(async () => {
      const failure = await apiSend(path, 'PUT', { credentials });
      setCredentials({});
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Credentials replaced');
      await follow();
      router.refresh();
    });
  };

  return (
    <ActionDialog
      trigger={<Button size="sm">Replace credentials</Button>}
      title={`Replace credentials for ${name}`}
      description="The new credentials must belong to the same account. The old ones stop being used, but you still need to delete them with your provider."
      confirmLabel="Replace credentials"
      canConfirm={isComplete(fields, credentials)}
      pending={pending}
      onConfirm={replace}
    >
      <CredentialFields fields={fields} values={credentials} onChange={setCredentials} />
    </ActionDialog>
  );
}
