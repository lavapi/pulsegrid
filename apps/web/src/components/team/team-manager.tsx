'use client';

import type { Role, Team } from '@pulsegrid/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Dropdown } from '@/components/ui/dropdown';
import { apiSend } from '@/lib/browser-api';
import { Time } from '@/components/ui/time';
import { useRefreshingAction } from '@/components/use-refreshing-action';

interface TeamManagerProps {
  team: Team;
  roles: Role[];
  currentUserId: string;
  canManage: boolean;
  projectName: string;
}

export function TeamManager({ team, roles, currentUserId, canManage, projectName }: TeamManagerProps) {
  const { pending, run } = useRefreshingAction();

  return (
    <>
      <Card>
        <CardHeader title={`Members (${team.members.length})`} />
        <ul className="divide-y">
          {team.members.map((member) => (
            <li className="flex flex-wrap items-center gap-3 px-5 py-3" key={member.id}>
              <span className="min-w-48 flex-1">
                <span className="block text-[13px] font-medium">{member.displayName}</span>
                <span className="block text-xs text-muted-foreground">
                  {member.email} · Last active <Time value={member.lastLoginAt} withZone />
                </span>
              </span>
              {member.isOwner && <Badge tone="neutral">Super admin</Badge>}
              <Dropdown
                label={`Role for ${member.email}`}
                value={member.roleId}
                className="w-36"
                disabled={pending || member.isOwner || !canManage}
                onValueChange={(next) =>
                  run(
                    () => apiSend(`/team/members/${member.id}`, 'PUT', { roleId: next }),
                    'Role updated',
                  )
                }
                options={roles.map(({ id, name }) => ({ value: id, label: name }))}
              />
              {canManage && member.id !== currentUserId && !member.isOwner && (
                <ConfirmButton
                  label="Remove"
                  title={`Remove ${member.displayName}?`}
                  description={`They'll lose access to ${projectName}. Their sign-in and other projects stay.`}
                  confirmLabel="Remove from project"
                  disabled={pending}
                  onConfirm={() =>
                    run(() => apiSend(`/team/members/${member.id}`, 'DELETE'), 'Removed from project')
                  }
                />
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
