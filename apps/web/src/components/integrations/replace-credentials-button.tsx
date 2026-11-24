'use client';

import type { CredentialField } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/pipelines/action-dialog';
import { useSyncProgress } from '@/components/sync/sync-progress-provider';
import { Button } from '@/components/ui/button';
import { apiSend } from '@/lib/browser-api';
import { CredentialFields, type CredentialValues, isComplete } from './credential-fields';

const DEFAULT_LABEL = 'Replace credentials';
const DEFAULT_DESCRIPTION =
  'The new credentials must belong to the same account. The old ones stop being used, but you still need to delete them with your provider.';

interface ReplaceCredentialsButtonProps {
  path: string;
  name: string;
  fields: readonly CredentialField[];
  label?: string;
  description?: string;
  success?: string;
  /** Shown above the fields, such as what a role must trust. */
  guide?: ReactNode;
}

export function ReplaceCredentialsButton({
  path,
  name,
  fields,
  label = DEFAULT_LABEL,
  description = DEFAULT_DESCRIPTION,
  success = 'Credentials replaced',
  guide,
}: ReplaceCredentialsButtonProps) {
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
      toast.success(success);
      await follow();
      router.refresh();
    });
  };

  return (
    <ActionDialog
      trigger={<Button size="sm">{label}</Button>}
      title={`${label} for ${name}`}
      description={description}
      confirmLabel={label}
      canConfirm={isComplete(fields, credentials)}
      pending={pending}
      onConfirm={replace}
    >
      {guide}
      <CredentialFields fields={fields} values={credentials} onChange={setCredentials} />
    </ActionDialog>
  );
}
