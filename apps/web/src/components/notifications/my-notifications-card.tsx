'use client';

import {
  type MyNotifications,
  NOTIFICATION_SWITCH_LABELS,
  type NotificationSwitches,
  type SlackReach,
} from '@pulsegrid/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { apiSend } from '@/lib/browser-api';
import { TestMessageButton } from './test-message-button';

const SWITCHES = Object.keys(NOTIFICATION_SWITCH_LABELS) as (keyof NotificationSwitches)[];

const REACH: Record<SlackReach['status'], { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  found: { label: 'Slack found', tone: 'success' },
  'not-found': { label: 'Not found in Slack', tone: 'warning' },
  'not-connected': { label: 'Slack not connected', tone: 'neutral' },
  unknown: { label: "Can't check Slack", tone: 'warning' },
};

const REACH_HINT: Record<SlackReach['status'], string> = {
  found: '',
  'not-found': 'No Slack account uses your sign-in email. Ask an admin to check your Slack email.',
  'not-connected': 'Messages start once an admin connects Slack under Integrations.',
  unknown: "Slack didn't answer. Try again in a minute.",
};

const switchesOf = (settings: MyNotifications): NotificationSwitches => ({
  prReady: settings.prReady,
  prFailed: settings.prFailed,
  deployReady: settings.deployReady,
  deployFailed: settings.deployFailed,
});

export function MyNotificationsCard({ settings }: { settings: MyNotifications }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [githubLogin, setGithubLogin] = useState(settings.githubLogin ?? '');
  const [switches, setSwitches] = useState(switchesOf(settings));
  const reach = REACH[settings.slack.status];

  const save = (event: FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const login = githubLogin.trim();
      const failure = await apiSend('/notifications/me', 'PUT', { ...switches, githubLogin: login || null });
      if (failure) {
        toast.error(failure);
        return;
      }
      toast.success('Notifications saved');
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader
        title="Notifications"
        description={
          settings.slack.status === 'found'
            ? `Personal Slack messages to ${settings.slack.name}`
            : 'Personal Slack messages about your pull requests and deploys'
        }
        action={
          <Badge tone={reach.tone} dot>
            {reach.label}
          </Badge>
        }
      />
      <form className="flex max-w-md flex-col gap-4 p-5" onSubmit={save}>
        {REACH_HINT[settings.slack.status] && (
          <p className="text-[13px] text-muted-foreground">{REACH_HINT[settings.slack.status]}</p>
        )}
        <Field label="GitHub username" hint="Pull requests you open and runs you start are matched by it">
          <Input
            value={githubLogin}
            maxLength={39}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setGithubLogin(event.target.value)}
          />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">Message me when</legend>
          {SWITCHES.map((key) => (
            <label key={key} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={switches[key]}
                disabled={pending}
                onChange={(event) => setSwitches({ ...switches, [key]: event.target.checked })}
              />
              {NOTIFICATION_SWITCH_LABELS[key]}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <TestMessageButton disabled={settings.slack.status !== 'found'} />
        </div>
      </form>
    </Card>
  );
}
