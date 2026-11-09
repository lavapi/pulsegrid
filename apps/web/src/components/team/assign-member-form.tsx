'use client';

import type { Person, Role } from '@pulsegrid/shared';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Dropdown } from '@/components/ui/dropdown';
import { Field } from '@/components/ui/input';
import { useRefreshingAction } from '@/components/use-refreshing-action';
import { apiSend } from '@/lib/browser-api';

const smallestRole = (roles: Role[]): Role | undefined =>
  roles.reduce<Role | undefined>(
    (smallest, role) => (!smallest || role.permissions.length < smallest.permissions.length ? role : smallest),
    undefined,
  );

export function AssignMemberForm({ people, roles, projectName }: { people: Person[]; roles: Role[]; projectName: string }) {
  const { pending, run } = useRefreshingAction();
  const [accountId, setAccountId] = useState('');
  const [roleId, setRoleId] = useState(smallestRole(roles)?.id ?? '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    run(() => apiSend('/team/assignments', 'POST', { accountId, roleId }), 'Member added', () => setAccountId(''));
  };

  return (
    <Card>
      <CardHeader
        title={`Add to ${projectName}`}
        description="Pick someone from People and choose their role in this project."
      />
      {people.length > 0 ? (
        <form className="flex flex-wrap items-end gap-3 p-5" onSubmit={submit}>
          <Field label="Person" labelsOwnControl className="min-w-60 flex-1 sm:max-w-sm">
            <Dropdown
              label="Person"
              value={accountId}
              onValueChange={setAccountId}
              options={people.map(({ id, displayName, email }) => ({ value: id, label: displayName, description: email }))}
            />
          </Field>
          <Field label="Role" labelsOwnControl className="w-44">
            <Dropdown
              label="Role"
              value={roleId}
              onValueChange={setRoleId}
              options={roles.map(({ id, name }) => ({ value: id, label: name }))}
            />
          </Field>
          <Button variant="primary" disabled={pending || !accountId || !roleId}>
            Add member
          </Button>
        </form>
      ) : (
        <p className="px-5 py-4 text-[13px] text-muted-foreground">
          Everyone is already in this project.{' '}
          <Link href="/settings/people" className="text-primary hover:underline">
            Add someone new under People
          </Link>
          .
        </p>
      )}
    </Card>
  );
}
