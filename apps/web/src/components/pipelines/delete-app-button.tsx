'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend } from '@/lib/browser-api';

export function DeleteAppButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const failure = await apiSend(`/pipelines/apps/${id}`, 'DELETE');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('App deleted');
      router.push('/pipelines');
      router.refresh();
    });
  };

  return (
    <ConfirmButton
      label="Delete app"
      title={`Delete ${name}?`}
      description="This removes the app from the dashboard. Nothing changes on GitHub."
      confirmLabel="Delete app"
      disabled={pending}
      onConfirm={remove}
    />
  );
}
