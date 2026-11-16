import { hasPermission, type SlackIntegration } from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SlackCard } from '@/components/integrations/slack-card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function SlackIntegrationPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'integrations.manage')) {
    redirect('/');
  }
  const slack = await apiGet<SlackIntegration>('/integrations/slack');
  return (
    <>
      <PageHeader
        title="Slack"
        description="Where PulseGrid posts security alerts"
        leading={
          <Button asChild variant="ghost" size="icon" aria-label="Back to integrations">
            <Link href="/settings/integrations">
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
          </Button>
        }
      />
      <SlackCard slack={slack} />
    </>
  );
}
