import { hasPermission, SLACK_APP_MANIFEST, type SlackApp } from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SlackAppCard } from '@/components/notifications/slack-app-card';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

const SETUP_STEPS = [
  'Open api.slack.com/apps, choose Create New App → From a manifest, and pick your workspace.',
  'Paste the manifest below and create the app.',
  'Choose Install to Workspace and allow it.',
  'Copy the Bot User OAuth Token from OAuth & Permissions and paste it above.',
];

export default async function SlackIntegrationPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'integrations.manage')) {
    redirect('/');
  }
  const app = await apiGet<SlackApp>('/integrations/slack');

  return (
    <>
      <Link
        href="/settings/integrations"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Integrations
      </Link>
      <PageHeader
        title="Slack"
        description="Personal messages when pull requests are ready to merge and deploys finish"
      />
      <SlackAppCard app={app} />
      <Card>
        <CardHeader
          title="Create the Slack app"
          description="People choose what they get under Your account → Notifications"
          action={<CopyButton value={SLACK_APP_MANIFEST} label="Copy manifest" />}
        />
        <ol className="flex list-decimal flex-col gap-1.5 px-10 pt-5 text-[13px]">
          {SETUP_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-5 text-xs">{SLACK_APP_MANIFEST}</pre>
      </Card>
    </>
  );
}
