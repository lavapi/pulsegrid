'use client';

import type { Person } from '@pulsegrid/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend } from '@/lib/browser-api';
import { useRefreshingAction } from '@/components/use-refreshing-action';

function PersonProjects({ person }: { person: Person }) {
  if (person.projects.length === 0) {
    return <span className="text-xs text-warning">Not in any project</span>;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {person.projects.map((project) => (
        <Badge key={project.id}>
          {project.name} · {project.roleName}
        </Badge>
      ))}
    </span>
  );
}

export function PeopleList({ people, currentAccountEmail }: { people: Person[]; currentAccountEmail: string }) {
  const { pending, run } = useRefreshingAction();

  return (
    <Card>
      <CardHeader title={`People (${people.length})`} />
      <ul className="divide-y">
        {people.map((person) => (
          <li className="flex flex-wrap items-center gap-3 px-5 py-3" key={person.id}>
            <span className="flex min-w-60 flex-1 flex-col gap-1.5">
              <span>
                <span className="block text-[13px] font-medium">{person.displayName}</span>
                <span className="block text-xs text-muted-foreground">{person.email}</span>
              </span>
              <PersonProjects person={person} />
            </span>
            {person.isSuperAdmin && <Badge tone="primary">Super admin</Badge>}
            {person.pendingPassword && <Badge tone="warning">Hasn't signed in yet</Badge>}
            {!person.pendingPassword && !person.twoFactorEnabled && <Badge tone="warning">Two-factor not set up</Badge>}
            {!person.isSuperAdmin && (
              <>
                <ConfirmButton
                  label="Make super admin"
                  title={`Make ${person.displayName} the super admin?`}
                  description="They'll see every project and manage people and projects. You'll keep your project roles, but you'll no longer be the super admin."
                  confirmLabel="Make super admin"
                  disabled={pending}
                  onConfirm={() =>
                    run(() => apiSend(`/people/${person.id}/super-admin`, 'POST'), 'Super admin changed')
                  }
                />
                {person.email !== currentAccountEmail && (
                  <ConfirmButton
                    label="Remove"
                    title={`Remove ${person.displayName}?`}
                    description="They'll be signed out and lose access to every project. To let them back in, add them again."
                    confirmLabel="Remove person"
                    disabled={pending}
                    onConfirm={() => run(() => apiSend(`/people/${person.id}`, 'DELETE'), 'Person removed')}
                  />
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
