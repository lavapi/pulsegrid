'use client';

import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { useRefreshingAction } from '@/components/use-refreshing-action';
import { apiSend } from '@/lib/browser-api';

const MAX_NAME_LENGTH = 60;

export function RenameProjectForm({ name }: { name: string }) {
  const { pending, run } = useRefreshingAction();
  const [value, setValue] = useState(name);

  const save = (event: FormEvent) => {
    event.preventDefault();
    run(() => apiSend('/projects/current', 'PUT', { name: value }), 'Project renamed');
  };

  return (
    <Card>
      <CardHeader title="Name" description="Shown in the project switcher and page titles." />
      <form className="flex flex-wrap items-end gap-2 p-5" onSubmit={save}>
        <Field label="Project name" className="min-w-60 flex-1 sm:max-w-sm">
          <Input value={value} required maxLength={MAX_NAME_LENGTH} onChange={(event) => setValue(event.target.value)} />
        </Field>
        <Button variant="primary" disabled={pending || value.trim() === name || value.trim() === ''}>
          Save
        </Button>
      </form>
    </Card>
  );
}
