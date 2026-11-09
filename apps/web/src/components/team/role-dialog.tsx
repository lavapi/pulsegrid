'use client';

import {
  PERMISSION_GROUPS,
  permissionLabel,
  type Role,
  type RoleInput,
  type UserPermission,
} from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { apiSend } from '@/lib/browser-api';

const EMPTY_ROLE: RoleInput = { name: '', permissions: [] };

interface RoleDialogProps {
  role?: Role;
  trigger: ReactNode;
}

export function RoleDialog({ role, trigger }: RoleDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const saved = role ?? EMPTY_ROLE;
  const [name, setName] = useState(saved.name);
  const [selected, setSelected] = useState(saved.permissions);

  const change = (next: boolean) => {
    setOpen(next);
    setName(saved.name);
    setSelected(saved.permissions);
  };

  const toggle = (permission: UserPermission) =>
    setSelected(
      selected.includes(permission)
        ? selected.filter((item) => item !== permission)
        : [...selected, permission],
    );

  const save = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const body = { name, permissions: selected };
      const failure = await (role ? apiSend(`/roles/${role.id}`, 'PUT', body) : apiSend('/roles', 'POST', body));
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Role saved');
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-base font-semibold">{role ? `Edit ${role.name}` : 'New role'}</DialogTitle>
        <form className="mt-4 flex flex-col gap-4" onSubmit={save}>
          <Field label="Name">
            <Input value={name} required maxLength={60} onChange={(event) => setName(event.target.value)} />
          </Field>
          <div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto">
            {PERMISSION_GROUPS.map(({ title, permissions }) => (
              <fieldset key={title}>
                <legend className="px-2 pb-1 text-[11px] font-semibold text-faint">{title}</legend>
                {permissions.map((permission) => (
                  <label
                    className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-muted"
                    key={permission}
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={selected.includes(permission)}
                      onChange={() => toggle(permission)}
                    />
                    {permissionLabel(permission)}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button">Cancel</Button>
            </DialogClose>
            <Button variant="primary" disabled={pending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
