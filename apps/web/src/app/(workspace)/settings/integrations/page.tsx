import {
  type CloudAccount,
  CLOUD_PROVIDERS,
  GIT_PROVIDERS,
  type GitConnection,
  hasPermission,
} from '@pulsegrid/shared';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ProviderIcon } from '@/components/provider-icon';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

interface IntegrationLinkProps {
  href: string;
  provider: { id: string; label: string; description: string };
  count: number;
  unit: string;
}

function IntegrationLink({ href, provider, count, unit }: IntegrationLinkProps) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-xl border bg-card p-5 transition-colors hover:bg-muted/40"
    >
      <ProviderIcon provider={provider.id} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{provider.label}</span>
        <span className="block text-[13px] text-muted-foreground">{provider.description}</span>
      </span>
      <Badge tone={count > 0 ? 'success' : 'neutral'}>
        {count} {count === 1 ? unit : `${unit}s`}
      </Badge>
      <ChevronRight className="size-4 text-faint" aria-hidden="true" />
    </Link>
  );
}

export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, 'integrations.manage')) {
    redirect('/');
  }
  const [accounts, connections] = await Promise.all([
    apiGet<CloudAccount[]>('/cloud/accounts'),
    apiGet<GitConnection[]>('/git/connections'),
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
            provider={provider}
            count={
              accounts.filter((item) => item.provider === provider.id && item.hasCredentials).length
            }
            unit="account"
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
            provider={provider}
            count={connections.filter((item) => item.provider === provider.id).length}
            unit="connection"
          />
        ))}
      </section>
    </>
  );
}
