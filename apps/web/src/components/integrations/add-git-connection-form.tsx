'use client';

import type { GitAccessCheck, GitProviderDefinition } from '@pulsegrid/shared';
import { Check, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { apiSend, apiSendForJson } from '@/lib/browser-api';
import { CredentialFields, type CredentialValues, isComplete } from './credential-fields';

function AccessResult({ result }: { result: GitAccessCheck }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-[13px]" role="status">
      <p className="flex items-center gap-1.5 font-medium">
        <Check className="size-3.5 text-success" aria-hidden="true" />
        Connected{result.account ? ` as ${result.account}` : ''}
      </p>
      <p className="text-muted-foreground">
        Can read {result.repositories}
        {result.repositories >= 100 ? '+' : ''} repositories
      </p>
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        {result.canRun
          ? 'Can run pipelines'
          : "We can't tell if it can run pipelines. Check the permissions below."}
      </p>
    </div>
  );
}

export function AddGitConnectionForm({ provider }: { provider: GitProviderDefinition }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [credentials, setCredentials] = useState<CredentialValues>({});
  const [result, setResult] = useState<GitAccessCheck | null>(null);

  const target = { provider: provider.id, organization: organization.trim(), credentials };
  const ready = organization.trim() !== '' && isComplete(provider.credentialFields, credentials);

  const reset = (update: () => void) => {
    update();
    setResult(null);
  };

  const test = () => {
    startTransition(async () => {
      const { data, error } = await apiSendForJson<GitAccessCheck>(
        '/git/connections/check',
        'POST',
        target,
      );
      if (error) {
        toast.error(error);
      }
      setResult(data);
    });
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const failure = await apiSend('/git/connections', 'POST', { ...target, name });
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Connection added');
      setName('');
      setOrganization('');
      reset(() => setCredentials({}));
      router.refresh();
    });
  };

  return (
    <form className="flex flex-col gap-4 p-5" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <Input
            value={name}
            maxLength={100}
            required
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label={provider.organizationLabel} hint={provider.organizationHint}>
          <Input
            value={organization}
            required
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => reset(() => setOrganization(event.target.value))}
          />
        </Field>
        <CredentialFields
          fields={provider.credentialFields}
          values={credentials}
          onChange={(values) => reset(() => setCredentials(values))}
        />
      </div>
      {result && <AccessResult result={result} />}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending || !ready} onClick={test}>
          {pending ? 'Checking…' : 'Test credentials'}
        </Button>
        <Button variant="primary" disabled={pending || !result || name.trim() === ''}>
          Save connection
        </Button>
      </div>
    </form>
  );
}
