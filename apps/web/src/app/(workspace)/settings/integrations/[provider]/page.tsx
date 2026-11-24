import {
  type CloudAccount,
  cloudProvider,
  type EnvironmentAdminView,
  hasPermission,
  type RoleTrustDetails,
} from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AddCloudAccountForm } from '@/components/integrations/add-cloud-account-form';
import { CloudAccountCard } from '@/components/integrations/cloud-account-card';
import { SyncProgressCards } from '@/components/sync/sync-progress-card';
import { Card, CardHeader } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { OutboundAddressCard } from '@/components/integrations/outbound-address-card';
import { ProviderSetupCard } from '@/components/integrations/provider-setup-card';
import { apiGet, apiGetOptional, getCurrentUser } from '@/lib/server-api';

export default async function ProviderIntegrationPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const provider = cloudProvider((await params).provider);
  if (!provider) {
    notFound();
  }
  const user = await getCurrentUser();
  if (!hasPermission(user, 'integrations.manage')) {
    redirect('/');
  }
  const [accounts, { environments }, outbound, trust] = await Promise.all([
    apiGet<CloudAccount[]>('/cloud/accounts'),
    apiGet<EnvironmentAdminView>('/environments/manage'),
    apiGetOptional<{ address: string | null }>('/cloud/accounts/outbound-address'),
    apiGetOptional<RoleTrustDetails>('/cloud/accounts/role-trust'),
  ]);
  const own = accounts.filter((account) => account.provider === provider.id);
  const anyKeys = own.some(({ hasCredentials, credentialKind }) => hasCredentials && credentialKind === 'key');

  return (
    <>
      <Link
        href="/settings/integrations"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Integrations
      </Link>
      <PageHeader title={provider.label} description={provider.description} />
      <SyncProgressCards />
      {own.map((account) => (
        <CloudAccountCard
          account={account}
          methods={provider.connectionMethods}
          trust={trust}
          regions={provider.regions}
          key={account.id}
        />
      ))}
      <Card>
        <CardHeader
          title={`Add ${provider.accountLabel}`}
          description="We detect the account from the role or key. Test it before saving."
        />
        <AddCloudAccountForm provider={provider} environments={environments} trust={trust} />
      </Card>
      <ProviderSetupCard setup={provider.setup} />
      {provider.id === 'aws' && anyKeys && <OutboundAddressCard address={outbound?.address ?? null} />}
    </>
  );
}
