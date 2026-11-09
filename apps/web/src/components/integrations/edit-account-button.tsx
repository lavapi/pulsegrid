'use client';

import type { AccountTagSummary, CloudAccount, TagFilter } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ActionDialog } from '@/components/pipelines/action-dialog';
import { useSyncProgress } from '@/components/sync/sync-progress-provider';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { apiSend, apiSendForJson } from '@/lib/browser-api';
import { cleanTagFilter, keptCount, tagSuggestions } from '@/lib/tag-suggestions';
import { RegionPicker } from './region-picker';
import { TagFilterFields } from './tag-filter-fields';

interface EditAccountButtonProps {
  account: CloudAccount;
  regions: readonly string[];
}

export function EditAccountButton({ account, regions }: EditAccountButtonProps) {
  const router = useRouter();
  const { follow } = useSyncProgress();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(account.name);
  const [selected, setSelected] = useState(account.regions);
  const [tagFilter, setTagFilter] = useState<TagFilter>(account.tagFilter);
  const [tagSets, setTagSets] = useState<Record<string, string>[]>([]);
  const suggestions = useMemo(() => tagSuggestions(tagSets), [tagSets]);
  const cleaned = cleanTagFilter(tagFilter);

  const open = async (isOpen: boolean) => {
    setName(account.name);
    setSelected(account.regions);
    setTagFilter(account.tagFilter);
    if (isOpen) {
      const path = `/cloud/accounts/${account.id}/tags`;
      const { data } = await apiSendForJson<AccountTagSummary>(path, 'GET');
      setTagSets(data?.tagSets ?? []);
    }
  };

  const save = () => {
    startTransition(async () => {
      const failure = await apiSend(`/cloud/accounts/${account.id}`, 'PUT', {
        name: name.trim(),
        regions: selected,
        tagFilter: cleaned,
      });
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Account updated');
      await follow();
      router.refresh();
    });
  };

  return (
    <ActionDialog
      trigger={<Button size="sm">Edit</Button>}
      title={`Edit ${account.name}`}
      description="Saving starts a sync. Resources that no longer match are removed, and matching ones come back."
      confirmLabel="Save"
      wide
      canConfirm={name.trim() !== '' && selected.length > 0}
      pending={pending}
      onOpenChange={open}
      onConfirm={save}
    >
      <Field label="Name">
        <Input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
      </Field>
      <RegionPicker regions={regions} selected={selected} onChange={setSelected} />
      <TagFilterFields value={tagFilter} onChange={setTagFilter} suggestions={suggestions} />
      {tagSets.length > 0 && (
        <p className="text-[13px] text-muted-foreground" role="status">
          Of the {tagSets.length} resources stored now, {keptCount(tagSets, cleaned)} would be kept.
        </p>
      )}
    </ActionDialog>
  );
}
