'use client';

import type { Project } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { apiSendForJson } from '@/lib/browser-api';

const MAX_NAME_LENGTH = 60;

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');

  const change = (next: boolean) => {
    onOpenChange(next);
    setName('');
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const { data, error } = await apiSendForJson<Project>('/projects', 'POST', { name });
      if (error || !data) {
        toast.error(error ?? "We couldn't create that project.");
        return;
      }
      toast.success(`${data.name} created`);
      change(false);
      router.push('/');
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">New project</DialogTitle>
        <DialogDescription className="mt-1 text-[13px] text-muted-foreground">
          It starts empty, with Staging and Production. Add its cloud accounts and Git connection under
          Integrations, and assign people under Members.
        </DialogDescription>
        <form className="mt-4 flex flex-col gap-4" onSubmit={create}>
          <Field label="Name">
            <Input
              value={name}
              required
              autoFocus
              maxLength={MAX_NAME_LENGTH}
              placeholder="Payments platform"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button variant="primary" disabled={pending}>
              Create project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
