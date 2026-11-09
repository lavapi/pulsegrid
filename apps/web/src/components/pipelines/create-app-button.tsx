'use client';

import type { RepositoryChoice } from '@pulsegrid/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { SearchableList } from '@/components/ui/searchable-list';
import { ActionDialog } from './action-dialog';
import { usePipelineAction } from './use-pipeline-action';

export function CreateAppButton({ repositories }: { repositories: RepositoryChoice[] }) {
  const { pending, send } = usePipelineAction();
  const [name, setName] = useState('');
  const [choice, setChoice] = useState('');
  const options = repositories.map(({ connectionId, connectionName, repository }) => ({
    value: `${connectionId}|${repository}`,
    label: repository,
    description: connectionName,
  }));

  return (
    <ActionDialog
      trigger={
        <Button variant="primary" disabled={pending}>
          <Plus />
          Create app
        </Button>
      }
      title="Create app"
      description="Give the app a name and choose the repository that holds its pipelines."
      confirmLabel="Create app"
      canConfirm={name.trim() !== '' && choice !== ''}
      pending={pending}
      onConfirm={() => {
        const [connectionId, repository] = choice.split('|');
        send('/pipelines/apps', { name: name.trim(), connectionId, repository }, 'App created');
        setName('');
        setChoice('');
      }}
    >
      <Field label="App name">
        <Input
          value={name}
          maxLength={60}
          required
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field label="Repository" labelsOwnControl>
        <SearchableList
          label="Repository"
          placeholder="Search repositories"
          emptyMessage="No repositories available"
          options={options}
          value={choice}
          onValueChange={setChoice}
        />
      </Field>
    </ActionDialog>
  );
}
