'use client';

import type { EnvironmentAdminView, ManagedEnvironment } from '@pulsegrid/shared';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Dropdown } from '@/components/ui/dropdown';
import { Field, Input } from '@/components/ui/input';
import { apiSend, apiSendForJson } from '@/lib/browser-api';
import { EnvironmentDomains } from './environment-domains';
import { useRefreshingAction } from './use-refreshing-action';

export function EnvironmentManager({ view }: { view: EnvironmentAdminView }) {
  const { pending, run } = useRefreshingAction();

  const save = (path: string, method: 'POST' | 'PUT', body: unknown) => async () =>
    (await apiSendForJson(path, method, body)).error;

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get('name');
    run(save('/environments', 'POST', { name }), 'Environment added', () => form.reset());
  };

  const rename = (event: FormEvent<HTMLFormElement>, environment: ManagedEnvironment) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get('name');
    run(save(`/environments/${environment.id}`, 'PUT', { name }), 'Environment renamed');
  };

  const assign = (cloudAccountId: string, environmentId: string) => {
    run(
      () =>
        apiSend(`/environments/accounts/${cloudAccountId}`, 'PUT', {
          environmentId: environmentId || null,
        }),
      'Account updated',
    );
  };

  const environmentOptions = [
    { value: '', label: 'None' },
    ...view.environments.map(({ id, name }) => ({ value: id, label: name })),
  ];

  return (
    <>
      <Card>
        <CardHeader title="Environments" />
        <div className="flex flex-col gap-3 p-5">
          {view.environments.map((environment) => (
            <div className="flex flex-col gap-3 border-b pb-4" key={environment.id}>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => rename(event, environment)}
            >
              <Input
                name="name"
                required
                maxLength={60}
                defaultValue={environment.name}
                aria-label={`Name of ${environment.name}`}
                className="min-w-44 flex-1 sm:max-w-sm"
              />
              <Button size="sm" disabled={pending}>
                Rename
              </Button>
              <ConfirmButton
                label="Remove"
                title={`Remove ${environment.name}?`}
                description="Its accounts and their data stay, but they're no longer grouped."
                confirmLabel="Remove environment"
                disabled={pending}
                onConfirm={() =>
                  run(() => apiSend(`/environments/${environment.id}`, 'DELETE'), 'Environment removed')
                }
              />
            </form>
            <EnvironmentDomains environment={environment} />
            </div>
          ))}
          <form className="flex flex-wrap items-end gap-2" onSubmit={create}>
            <Field label="New environment" className="min-w-44 flex-1 sm:max-w-sm">
              <Input name="name" required maxLength={60} placeholder="Development" />
            </Field>
            <Button disabled={pending}>Add environment</Button>
          </form>
        </div>
      </Card>
      <Card>
        <CardHeader title="Cloud accounts" description="Choose the environment for each account." />
        <ul className="divide-y">
          {view.accounts.map((account) => (
            <li
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              key={account.cloudAccountId}
            >
              <span>
                <span className="block font-medium">{account.name}</span>
                <span className="text-[13px] text-muted-foreground">{account.accountId}</span>
              </span>
              <Dropdown
                label={`Environment for ${account.name}`}
                disabled={pending}
                value={account.environmentId ?? ''}
                onValueChange={(environmentId) => assign(account.cloudAccountId, environmentId)}
                className="w-48"
                options={environmentOptions}
              />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
