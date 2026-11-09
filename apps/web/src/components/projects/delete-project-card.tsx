'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { apiSend } from '@/lib/browser-api';

const WHAT_GOES =
  'Its cloud accounts and access keys, Git connections, environments, domains, pipeline apps, releases, costs, roles, members and Activity are deleted. Nothing changes in AWS or GitHub. People stay under People.';

export function DeleteProjectCard({ name, isOnlyProject }: { name: string; isOnlyProject: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const change = (next: boolean) => {
    setOpen(next);
    setTyped('');
  };

  const remove = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const failure = await apiSend('/projects/current', 'DELETE', { confirmName: typed });
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success(`${name} deleted`);
      change(false);
      router.push('/');
      router.refresh();
    });
  };

  return (
    <Card className="border-danger/40">
      <CardHeader title="Delete project" description={WHAT_GOES} />
      <div className="flex flex-wrap items-center gap-3 p-5">
        {isOnlyProject ? (
          <p className="text-[13px] text-muted-foreground">This is the only project. Create another one before deleting it.</p>
        ) : (
          <Dialog open={open} onOpenChange={change}>
            <DialogTrigger asChild>
              <Button variant="danger">Delete {name}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle className="text-base font-semibold">Delete {name}?</DialogTitle>
              <DialogDescription className="mt-1.5 text-[13px] text-muted-foreground">
                {WHAT_GOES} This can't be undone.
              </DialogDescription>
              <form className="mt-4 flex flex-col gap-4" onSubmit={remove}>
                <Field label={`Type ${name} to confirm`}>
                  <Input value={typed} autoComplete="off" onChange={(event) => setTyped(event.target.value)} />
                </Field>
                <div className="flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button type="button" variant="ghost">
                      Cancel
                    </Button>
                  </DialogClose>
                  <Button variant="danger" disabled={pending || typed.trim() !== name}>
                    Delete project
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </Card>
  );
}
