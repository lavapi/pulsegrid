'use client';

import type { ExperimentTemplate, StartedExperiment } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend, apiSendForJson } from '@/lib/browser-api';
import { experimentPath } from '@/lib/experiments';

export function StartExperimentButton({ accountId, template }: { accountId: string; template: ExperimentTemplate }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const start = () =>
    startTransition(async () => {
      const { data, error } = await apiSendForJson<StartedExperiment>(
        `/cloud/accounts/${accountId}/experiments`,
        'POST',
        { region: template.region, templateId: template.id },
      );
      if (!data) {
        toast.error(error ?? 'The experiment did not start. Please try again.');
        return;
      }
      toast.success('Experiment started');
      router.push(experimentPath(data.region, data.id));
    });

  return (
    <ConfirmButton
      label="Start experiment"
      title={`Start ${template.label}?`}
      description="This deliberately breaks or slows the resources the template targets. It runs until it finishes, a stop alarm fires, or someone stops it."
      confirmLabel="Start experiment"
      triggerVariant="danger"
      typeToConfirm={template.label}
      disabled={pending}
      onConfirm={start}
    />
  );
}

export function StopExperimentButton({ accountId, region, id }: { accountId: string; region: string; id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const stop = () =>
    startTransition(async () => {
      const failure = await apiSend(`/cloud/accounts/${accountId}/experiments/${region}/${id}/stop`, 'POST');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Stopping the experiment');
      router.refresh();
    });

  return (
    <ConfirmButton
      label="Stop experiment"
      title="Stop this experiment?"
      description="AWS stops every step that is still running and undoes what it can, such as removing injected faults."
      confirmLabel="Stop experiment"
      triggerVariant="danger"
      disabled={pending}
      onConfirm={stop}
    />
  );
}
