'use client';

import type { ReleaseChoices } from '@pulsegrid/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { ActionDialog } from '@/components/pipelines/action-dialog';
import { usePipelineAction } from '@/components/pipelines/use-pipeline-action';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { SearchableList } from '@/components/ui/searchable-list';
import { decodeChoice, encodeChoice } from '@/lib/releases';

export function LinkServiceButton({ choices }: { choices: ReleaseChoices }) {
  const { pending, send } = usePipelineAction();
  const [pipeline, setPipeline] = useState('');
  const [service, setService] = useState('');

  const confirm = () => {
    const [appId, workflowId] = decodeChoice(pipeline);
    const [accountId, nativeId] = decodeChoice(service);
    send('/releases/targets', { appId, workflowId, accountId, nativeId }, 'Pipeline linked');
    setPipeline('');
    setService('');
  };

  return (
    <ActionDialog
      trigger={
        <Button variant="primary" disabled={pending}>
          <Plus />
          Link a service
        </Button>
      }
      title="Link a pipeline to a service"
      description="Choose a pipeline and the ECS service it deploys to. Only services in the selected account are listed, and the link shows only there."
      confirmLabel="Link"
      canConfirm={pipeline !== '' && service !== ''}
      pending={pending}
      onConfirm={confirm}
    >
      <Field label="Pipeline" labelsOwnControl>
        <SearchableList
          label="Pipeline"
          placeholder="Search pipelines"
          emptyMessage="No pipelines available"
          options={choices.pipelines.map(({ appId, workflowId, label }) => ({
            value: encodeChoice(appId, workflowId),
            label,
          }))}
          value={pipeline}
          onValueChange={setPipeline}
        />
      </Field>
      <Field label="Deploys to" labelsOwnControl>
        <SearchableList
          label="Deploys to"
          placeholder="Search services"
          emptyMessage="No ECS services found in this account"
          options={choices.services.map(({ accountId, nativeId, label, description }) => ({
            value: encodeChoice(accountId, nativeId),
            label,
            description,
          }))}
          value={service}
          onValueChange={setService}
        />
      </Field>
    </ActionDialog>
  );
}
