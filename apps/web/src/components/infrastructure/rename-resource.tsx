'use client';

import { DISPLAY_NAME_MAX_LENGTH, type Resource } from '@pulsegrid/shared';
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { apiSendForJson } from '@/lib/browser-api';

/** Gives a resource a display name in PulseGrid, or puts its cloud name back. Nothing changes in the cloud. */
export function RenameResource({ resource }: { resource: Pick<Resource, 'id' | 'name' | 'displayName'> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(resource.displayName ?? '');

  const save = (displayName: string) =>
    startTransition(async () => {
      const { data, error } = await apiSendForJson<Resource>(`/resources/${resource.id}/display-name`, 'PUT', {
        displayName,
      });
      if (!data) {
        toast.error(error ?? 'The name was not saved. Please try again.');
        return;
      }
      setOpen(false);
      toast.success(data.displayName ? `Shown as ${data.displayName}` : `Back to ${data.name}`);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setValue(resource.displayName ?? '');
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2">
          <Pencil aria-hidden="true" />
          Rename
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">Display name</DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          Shown everywhere in PulseGrid instead of <strong className="text-foreground">{resource.name}</strong>. The
          name in AWS doesn&apos;t change.
        </DialogDescription>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            save(value);
          }}
        >
          <Field label="Display name">
            <Input
              value={value}
              maxLength={DISPLAY_NAME_MAX_LENGTH}
              placeholder={resource.name}
              autoFocus
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
          <div className="flex flex-wrap justify-between gap-2">
            {resource.displayName ? (
              <Button type="button" variant="ghost" disabled={pending} onClick={() => save('')}>
                Reset to AWS name
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={pending || !value.trim()}>
                Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
