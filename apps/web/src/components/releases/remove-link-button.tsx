'use client';

import type { Release } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend } from '@/lib/browser-api';

export function RemoveLinkButton({ release: { id, appName, serviceName, serviceDisplayName } }: { release: Release }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const failure = await apiSend(`/releases/targets/${id}`, 'DELETE');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Link removed');
      router.refresh();
    });
  };

  return (
    <ConfirmButton
      label="Remove"
      title={`Remove ${appName} to ${serviceDisplayName ?? serviceName}?`}
      description="This only removes it from Releases. Nothing changes on GitHub or AWS."
      confirmLabel="Remove"
      disabled={pending}
      onConfirm={remove}
    />
  );
}
