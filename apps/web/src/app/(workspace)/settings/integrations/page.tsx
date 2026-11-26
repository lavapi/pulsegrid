import {
  type CloudAccount,
  CLOUD_PROVIDERS,
  GIT_PROVIDERS,
  type GitConnection,
  hasPermission,
  type SlackApp,
} from '@pulsegrid/shared';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SlackIcon } from '@/components/notifications/slack-icon';
import { ProviderIcon } from '@/components/provider-icon';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

interface IntegrationLinkProps {
  href: string;
  icon: ReactNode;
  label: string;
  description: string;
  status: ReactNode;
}

function IntegrationLink({ href, icon, label, description, status }: IntegrationLinkProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40"
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-[13px] text-muted-foreground">{description}</span>
      </span>
      {status}
      <ChevronRight className="size-4 text-faint" aria-hidden="true" />
    </Link>
  );
}

function CountBadge({ count, unit }: { count: number; unit: string }) {
  return (
    <Badge tone={count > 0 ? 'success' : 'neutral'}>
      {count} {count === 1 ? unit : `${unit}s`}
    </Badge>
  );
}

export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'integrations.manage')) {
    redirect('/');
  }
  const [accounts, connections, slack] = await Promise.all([
    apiGet<CloudAccount[]>('/cloud/accounts'),
    apiGet<GitConnection[]>('/git/connections'),
    apiGet<SlackApp>('/integrations/slack'),
  ]);

  return (
    <>
      <PageHeader title="Integrations" description="Connect the services this dashboard reads" />
      <section className="flex flex-col gap-3" aria-labelledby="cloud-integrations">
        <h2 className="text-sm font-semibold" id="cloud-integrations">
          Cloud
        </h2>
        {CLOUD_PROVIDERS.map((provider) => (
          <IntegrationLink
            key={provider.id}
            href={`/settings/integrations/${provider.id}`}
            icon={<ProviderIcon provider={provider.id} size={44} />}
            label={provider.label}
            description={provider.description}
            status={
              <CountBadge
                count={accounts.filter((item) => item.provider === provider.id && item.hasCredentials).length}
                unit="account"
              />
            }
          />
        ))}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="git-integrations">
        <h2 className="text-sm font-semibold" id="git-integrations">
          Git
        </h2>
        {GIT_PROVIDERS.map((provider) => (
          <IntegrationLink
            key={provider.id}
            href={`/settings/integrations/git/${provider.id}`}
            icon={<ProviderIcon provider={provider.id} size={44} />}
            label={provider.label}
            description={provider.description}
            status={
              <CountBadge count={connections.filter((item) => item.provider === provider.id).length} unit="connection" />
            }
          />
        ))}
      </section>
      <section className="flex flex-col gap-3" aria-labelledby="notification-integrations">
        <h2 className="text-sm font-semibold" id="notification-integrations">
          Notifications
        </h2>
        <IntegrationLink
          href="/settings/integrations/slack"
          icon={<SlackIcon />}
          label="Slack"
          description="Personal messages about pull requests and deploys"
          status={
            <Badge tone={slack.connected ? 'success' : 'neutral'}>
              {slack.connected ? 'Connected' : 'Not connected'}
            </Badge>
          }
        />
      </section>
    </>
  );
}
