'use client';

import { permissionLabel, type Role } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend } from '@/lib/browser-api';
import { RoleDialog } from './role-dialog';

const countOf = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;

function RoleRow({ role, canManage }: { role: Role; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const failure = await apiSend(`/roles/${role.id}`, 'DELETE');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Role deleted');
      router.refresh();
    });
  };

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="min-w-48 flex-1">
        <span className="block text-[13px] font-medium">{role.name}</span>
        <span className="block text-xs text-muted-foreground">
          {role.memberCount === 1 ? '1 person' : `${role.memberCount} people`}
          {' · '}
          <span title={role.permissions.map(permissionLabel).join(', ')}>
            {countOf(role.permissions.length, 'permission')}
          </span>
        </span>
      </span>
      {canManage && (
        <RoleDialog
          role={role}
          trigger={
            <Button variant="ghost" size="sm" disabled={pending}>
              Edit
            </Button>
          }
        />
      )}
      {canManage && role.memberCount === 0 && (
        <ConfirmButton
          label="Delete"
          title={`Delete ${role.name}?`}
          description="This can't be undone."
          confirmLabel="Delete"
          disabled={pending}
          onConfirm={remove}
        />
      )}
    </li>
  );
}

export function RoleManager({ roles, canManage }: { roles: Role[]; canManage: boolean }) {
  return (
    <Card>
      <CardHeader
        title={`Roles (${roles.length})`}
        action={canManage && <RoleDialog trigger={<Button size="sm">New role</Button>} />}
      />
      <ul className="divide-y">
        {roles.map((role) => (
          <RoleRow role={role} canManage={canManage} key={role.id} />
        ))}
      </ul>
    </Card>
  );
}
