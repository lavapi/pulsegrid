'use client';

import {
  type CloudProviderDefinition,
  type CredentialCheck,
  type CredentialKind,
  type RoleTrustDetails,
  EMPTY_TAG_FILTER,
  type ManagedEnvironment,
  type TagFilter,
} from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { useSyncProgress } from '@/components/sync/sync-progress-provider';
import { Button } from '@/components/ui/button';
import { Dropdown } from '@/components/ui/dropdown';
import { Field, Input } from '@/components/ui/input';
import { apiSend, apiSendForJson } from '@/lib/browser-api';
import { cleanTagFilter } from '@/lib/tag-suggestions';
import { CredentialFields, type CredentialValues, isComplete } from './credential-fields';
import { ConnectionMethodPicker } from './connection-method-picker';
import { CredentialResult } from './credential-result';
import { RegionPicker } from './region-picker';
import { RoleTrustGuide } from './role-trust-guide';
import { TagFilterFields } from './tag-filter-fields';

interface AddCloudAccountFormProps {
  provider: CloudProviderDefinition;
  environments: ManagedEnvironment[];
  trust: RoleTrustDetails | null;
}

export function AddCloudAccountForm({ provider, environments, trust }: AddCloudAccountFormProps) {
  const router = useRouter();
  const { follow } = useSyncProgress();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<CredentialKind>(provider.connectionMethods[0]?.id ?? 'key');
  const fields = provider.connectionMethods.find(({ id }) => id === kind)?.fields ?? [];
  const [credentials, setCredentials] = useState<CredentialValues>({});
  const [regions, setRegions] = useState<string[]>([provider.defaultRegion]);
  const [environmentId, setEnvironmentId] = useState('');
  const [tagFilter, setTagFilter] = useState<TagFilter>(EMPTY_TAG_FILTER);
  const [result, setResult] = useState<CredentialCheck | null>(null);

  const changeCredentials = (next: CredentialValues) => {
    setCredentials(next);
    setResult(null);
  };

  const changeKind = (next: CredentialKind) => {
    setKind(next);
    changeCredentials({});
  };

  const test = () => {
    startTransition(async () => {
      const { data, error } = await apiSendForJson<CredentialCheck>(
        '/cloud/accounts/check',
        'POST',
        { provider: provider.id, credentials },
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
      const failure = await apiSend('/cloud/accounts', 'POST', {
        provider: provider.id,
        credentials,
        name,
        regions,
        environmentId: environmentId || null,
        tagFilter: cleanTagFilter(tagFilter),
      });
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Account added');
      setName('');
      setTagFilter(EMPTY_TAG_FILTER);
      changeCredentials({});
      await follow();
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
            placeholder="Production"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Environment" labelsOwnControl>
          <Dropdown
            label="Environment"
            value={environmentId}
            onValueChange={setEnvironmentId}
            options={[
              { value: '', label: 'No environment' },
              ...environments.map(({ id, name: label }) => ({ value: id, label })),
            ]}
          />
        </Field>
      </div>
      <ConnectionMethodPicker methods={provider.connectionMethods} value={kind} onChange={changeKind} />
      {kind === 'role' && trust && <RoleTrustGuide trust={trust} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <CredentialFields fields={fields} values={credentials} onChange={changeCredentials} />
      </div>
      <RegionPicker regions={provider.regions} selected={regions} onChange={setRegions} />
      <TagFilterFields value={tagFilter} onChange={setTagFilter} />
      {result && <CredentialResult result={result} accountLabel={provider.accountLabel} />}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || !isComplete(fields, credentials)}
          onClick={test}
        >
          {pending ? 'Checking…' : kind === 'role' ? 'Test role' : 'Test credentials'}
        </Button>
        <Button
          variant="primary"
          disabled={pending || !result || name.trim() === '' || regions.length === 0}
        >
          Save integration
        </Button>
      </div>
    </form>
  );
}
