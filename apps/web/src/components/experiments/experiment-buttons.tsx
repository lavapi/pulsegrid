'use client';

import type { ExperimentTemplate, StartedExperiment, StartedExperimentRun } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend, apiSendForJson } from '@/lib/browser-api';
import { experimentPath, experimentRunPath } from '@/lib/experiments';

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

interface RunExperimentsButtonProps {
  accountId: string;
  /** The group to run, or none to run every template. */
  groupId?: string;
  label: string;
  templateLabels: string[];
  triggerLabel: string;
}

export function RunExperimentsButton({
  accountId,
  groupId,
  label,
  templateLabels,
  triggerLabel,
}: RunExperimentsButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const { data, error } = await apiSendForJson<StartedExperimentRun>(
        `/cloud/accounts/${accountId}/experiment-runs`,
        'POST',
        groupId ? { groupId } : {},
      );
      if (!data) {
        toast.error(error ?? 'The experiments did not start. Please try again.');
        return;
      }
      toast.success('Experiments started');
      router.push(experimentRunPath(data.id));
    });

  return (
    <ConfirmButton
      label={triggerLabel}
      title={`Start ${templateLabels.length} experiments?`}
      description={`This starts ${templateLabels.join(', ')} at the same time. Each deliberately breaks or slows the resources it targets until it finishes, a stop alarm fires, or someone stops it.`}
      confirmLabel="Start experiments"
      triggerVariant="danger"
      typeToConfirm={label}
      disabled={pending || templateLabels.length === 0}
      onConfirm={run}
    />
  );
}

export function StopRunButton({ accountId, runId }: { accountId: string; runId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const stop = () =>
    startTransition(async () => {
      const failure = await apiSend(`/cloud/accounts/${accountId}/experiment-runs/${runId}/stop`, 'POST');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Stopping the experiments');
      router.refresh();
    });

  return (
    <ConfirmButton
      label="Stop all"
      title="Stop every experiment in this run?"
      description="AWS stops every experiment that is still running and undoes what it can, such as removing injected faults."
      confirmLabel="Stop all"
      triggerVariant="danger"
      disabled={pending}
      onConfirm={stop}
    />
  );
}

export function DeleteGroupButton({ accountId, groupId, name }: { accountId: string; groupId: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const remove = () =>
    startTransition(async () => {
      const failure = await apiSend(`/cloud/accounts/${accountId}/experiment-groups/${groupId}`, 'DELETE');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Group deleted');
      router.refresh();
    });

  return (
    <ConfirmButton
      label="Delete"
      title={`Delete ${name}?`}
      description="This removes the group only. The templates stay in AWS."
      confirmLabel="Delete group"
      disabled={pending}
      onConfirm={remove}
    />
  );
}
