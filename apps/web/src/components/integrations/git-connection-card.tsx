'use client';

import type { CredentialField, GitConnection } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { apiSend } from '@/lib/browser-api';
import { ReplaceCredentialsButton } from './replace-credentials-button';

interface GitConnectionCardProps {
  connection: GitConnection;
  fields: readonly CredentialField[];
}

export function GitConnectionCard({ connection, fields }: GitConnectionCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { id, name, organization, credentialHint, status, lastError } = connection;
  const path = `/git/connections/${id}`;

  const run = (request: () => Promise<string | null>, success?: string) => {
    startTransition(async () => {
      const failure = await request();
      if (failure) {
        toast.error(failure);
        return;
      }
      if (success) {
        toast.success(success);
      }
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader
        title={name}
        description={`${organization} · ${credentialHint}`}
        action={
          <Badge tone={status === 'connected' ? 'success' : 'danger'} dot>
            {status === 'connected' ? 'Connected' : 'Connection failed'}
          </Badge>
        }
      />
      <div className="flex flex-col gap-3 p-5">
        {lastError && (
          <p className="text-[13px] text-danger" role="alert">
            {lastError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={pending} onClick={() => run(() => apiSend(`${path}/test`, 'POST'))}>
            {pending ? 'Testing' : 'Test connection'}
          </Button>
          <ReplaceCredentialsButton path={`${path}/credentials`} name={name} fields={fields} />
          <ConfirmButton
            label="Remove"
            title={`Remove ${name}?`}
            description="Apps using this connection stop showing pipelines until you add it again. Nothing changes on your Git provider."
            confirmLabel="Remove connection"
            disabled={pending}
            onConfirm={() => run(() => apiSend(path, 'DELETE'), 'Connection removed')}
          />
        </div>
      </div>
    </Card>
  );
}
