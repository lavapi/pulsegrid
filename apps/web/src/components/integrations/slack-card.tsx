'use client';

import type { SlackIntegration } from '@pulsegrid/shared';
import { type FormEvent, useState } from 'react';
import { useRefreshingAction } from '@/components/use-refreshing-action';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmButton } from '@/components/ui/confirm-button';
import { Field, Input } from '@/components/ui/input';
import { Time } from '@/components/ui/time';
import { apiSend } from '@/lib/browser-api';

/** Connects the Slack channel new critical and high security alerts are posted to. */
export function SlackCard({ slack }: { slack: SlackIntegration }) {
  const { pending, run } = useRefreshingAction();
  const [webhookUrl, setWebhookUrl] = useState('');

  const save = (event: FormEvent) => {
    event.preventDefault();
    run(
      () => apiSend('/integrations/slack', 'PUT', { webhookUrl }),
      'Slack connected.',
      () => setWebhookUrl(''),
    );
  };

  return (
    <Card>
      <CardHeader
        title="Slack"
        description="New critical and high AWS security alerts are posted to the channel, with a link to the alert."
      />
      <div className="flex flex-col gap-4 p-5 text-[13px]">
        {slack.connected && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              Connected{slack.updatedBy ? ` by ${slack.updatedBy}` : ''}
              {slack.updatedAt && (
                <>
                  , <Time value={slack.updatedAt} />
                </>
              )}
              .
            </span>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => apiSend('/integrations/slack/test', 'POST'), 'Test message sent to Slack.')}
            >
              Send test message
            </Button>
            <ConfirmButton
              label="Disconnect"
              title="Disconnect Slack?"
              description="New security alerts will only show in PulseGrid."
              confirmLabel="Disconnect"
              disabled={pending}
              onConfirm={() => run(() => apiSend('/integrations/slack', 'DELETE'), 'Slack disconnected.')}
            />
          </div>
        )}
        <form className="flex flex-col gap-3" onSubmit={save}>
          <Field label={slack.connected ? 'Replace the webhook URL' : 'Incoming webhook URL'}>
            <Input
              type="url"
              value={webhookUrl}
              required
              autoComplete="off"
              placeholder="https://hooks.slack.com/services/…"
              onChange={(event) => setWebhookUrl(event.target.value)}
            />
          </Field>
          <p className="text-muted-foreground">
            In Slack, create an app with Incoming Webhooks turned on, add a webhook for the channel, and paste its URL
            here. PulseGrid stores it encrypted and never shows it again.
          </p>
          <Button className="w-fit" variant="primary" type="submit" disabled={pending}>
            {slack.connected ? 'Replace' : 'Connect'}
          </Button>
        </form>
      </div>
    </Card>
  );
}
