'use client';

import type { ManagedEnvironment } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Dropdown } from '@/components/ui/dropdown';
import { apiSend } from '@/lib/browser-api';

interface EnvironmentLinkProps {
  appId: string;
  workflowId: string;
  environmentId: string | null;
  environments: Pick<ManagedEnvironment, 'id' | 'name'>[];
}

export function EnvironmentLink({
  appId,
  workflowId,
  environmentId,
  environments,
}: EnvironmentLinkProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const change = (nextEnvironmentId: string) => {
    startTransition(async () => {
      const failure = await apiSend('/pipelines/link', 'PUT', {
        appId,
        workflowId,
        environmentId: nextEnvironmentId || null,
      });
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Environment updated');
      router.refresh();
    });
  };

  return (
    <Dropdown
      label="Environment"
      value={environmentId ?? ''}
      onValueChange={change}
      disabled={pending}
      className="w-44"
      options={[
        { value: '', label: 'No environment' },
        ...environments.map(({ id, name }) => ({ value: id, label: name })),
      ]}
    />
  );
}
