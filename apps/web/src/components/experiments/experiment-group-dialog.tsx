'use client';

import {
  EXPERIMENT_GROUP_NAME_LIMIT,
  EXPERIMENT_RUN_LIMIT,
  type ExperimentGroup,
  type ExperimentTemplate,
  type ExperimentTemplateRef,
  templateKey,
} from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { apiSend } from '@/lib/browser-api';

interface ExperimentGroupDialogProps {
  accountId: string;
  templates: ExperimentTemplate[];
  group?: ExperimentGroup;
  trigger: ReactNode;
}

interface TemplateOption {
  key: string;
  ref: ExperimentTemplateRef;
  label: string;
  detail: string;
}

const MISSING = 'No longer in AWS';

/** Every template in AWS, plus any the group still holds that AWS no longer has, so they can be removed. */
const templateOptions = (templates: ExperimentTemplate[], group?: ExperimentGroup): TemplateOption[] => {
  const inAws = templates.map(({ id, region, label }) => {
    const ref = { region, templateId: id };
    return { key: templateKey(ref), ref, label, detail: `${id} · ${region}` };
  });
  const known = new Set(inAws.map(({ key }) => key));
  const missing = (group?.templates ?? [])
    .filter((ref) => !known.has(templateKey(ref)))
    .map((ref) => ({ key: templateKey(ref), ref, label: ref.templateId, detail: MISSING }));
  return [...inAws, ...missing];
};

export function ExperimentGroupDialog({ accountId, templates, group, trigger }: ExperimentGroupDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const savedKeys = (group?.templates ?? []).map(templateKey);
  const [name, setName] = useState(group?.name ?? '');
  const [selected, setSelected] = useState(savedKeys);
  const full = selected.length >= EXPERIMENT_RUN_LIMIT;
  const options = templateOptions(templates, group);

  const change = (next: boolean) => {
    setOpen(next);
    setName(group?.name ?? '');
    setSelected(savedKeys);
  };

  const toggle = (key: string) =>
    setSelected(selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const picked = options.filter(({ key }) => selected.includes(key)).map(({ ref }) => ref);
    startTransition(async () => {
      const body = { name, templates: picked };
      const path = `/cloud/accounts/${accountId}/experiment-groups`;
      const failure = await (group ? apiSend(`${path}/${group.id}`, 'PUT', body) : apiSend(path, 'POST', body));
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Group saved');
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">{group ? `Edit ${group.name}` : 'New group'}</DialogTitle>
        <form className="mt-4 flex flex-col gap-4" onSubmit={save}>
          <Field label="Name">
            <Input
              value={name}
              required
              maxLength={EXPERIMENT_GROUP_NAME_LIMIT}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <fieldset className="flex max-h-[50vh] flex-col overflow-y-auto">
            <legend className="px-2 pb-1 text-[11px] font-semibold text-faint">
              Templates, up to {EXPERIMENT_RUN_LIMIT}
            </legend>
            {options.map(({ key, label, detail }) => {
              const checked = selected.includes(key);
              return (
                <label
                  key={key}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={checked}
                    disabled={!checked && full}
                    onChange={() => toggle(key)}
                  />
                  <span className="flex flex-col">
                    <span>{label}</span>
                    <span className="text-[12px] text-muted-foreground">{detail}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={pending || selected.length === 0}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
