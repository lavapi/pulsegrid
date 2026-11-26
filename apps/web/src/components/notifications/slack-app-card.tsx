'use client';

import type { SlackApp } from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Field } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Time } from '@/components/ui/time';
import { apiSend } from '@/lib/browser-api';
import { TestMessageButton } from './test-message-button';

function TokenForm({ replacing }: { replacing: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [botToken, setBotToken] = useState('');

  const save = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const failure = await apiSend('/integrations/slack', 'PUT', { botToken: botToken.trim() });
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Slack connected');
      setBotToken('');
      router.refresh();
    });
  };

  return (
    <form className="flex max-w-md flex-col gap-4" onSubmit={save}>
      <Field label={replacing ? 'New Bot User OAuth Token' : 'Bot User OAuth Token'} hint="Starts with xoxb-">
        <PasswordInput
          value={botToken}
          required
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setBotToken(event.target.value)}
        />
      </Field>
      <Button className="w-fit" variant="primary" disabled={pending || !botToken.trim().startsWith('xoxb-')}>
        {pending ? 'Checking…' : replacing ? 'Replace token' : 'Connect Slack'}
      </Button>
    </form>
  );
}

function DisconnectButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const disconnect = () => {
    startTransition(async () => {
      const failure = await apiSend('/integrations/slack', 'DELETE');
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Slack disconnected');
      router.refresh();
    });
  };

  return (
    <ConfirmButton
      label="Disconnect"
      title="Disconnect Slack?"
      description="Nobody will get pull request or deploy messages until Slack is connected again."
      confirmLabel="Disconnect"
      disabled={pending}
      onConfirm={disconnect}
    />
  );
}

export function SlackAppCard({ app }: { app: SlackApp }) {
  return (
    <Card>
      <CardHeader
        title="Slack app"
        description={
          app.connected
            ? `Messages are sent in ${app.workspace ?? 'your workspace'}`
            : 'Create the app from the manifest below, install it, then paste its bot token'
        }
        action={
          <Badge tone={app.connected ? 'success' : 'neutral'} dot>
            {app.connected ? 'Connected' : 'Not connected'}
          </Badge>
        }
      />
      <div className="flex flex-col gap-4 p-5">
        {app.connected && app.updatedAt && (
          <p className="text-[13px] text-muted-foreground">
            Connected by {app.updatedBy ?? 'someone who has left'} <Time value={app.updatedAt} withZone />
          </p>
        )}
        {app.connected && (
          <div className="flex flex-wrap gap-2">
            <TestMessageButton />
            <DisconnectButton />
          </div>
        )}
        <TokenForm replacing={app.connected} />
      </div>
    </Card>
  );
}
