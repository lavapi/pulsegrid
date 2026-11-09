import {
  type CloudAccount,
  CLOUD_PROVIDERS,
  type EnvironmentAdminView,
  GIT_PROVIDERS,
  type GitConnection,
} from '@pulsegrid/shared';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AddCloudAccountForm } from '@/components/integrations/add-cloud-account-form';
import { AddGitConnectionForm } from '@/components/integrations/add-git-connection-form';
import { SetupSteps } from '@/components/setup/setup-steps';
import { SyncProgressProvider } from '@/components/sync/sync-progress-provider';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { apiGet, getCurrentUser } from '@/lib/server-api';

function Added({ names }: { names: string[] }) {
  return names.map((name) => (
    <p className="flex items-center gap-2 border-b px-5 py-2.5 text-[13px]" key={name}>
      <Check className="size-4 text-success" aria-hidden="true" />
      {name}
    </p>
  ));
}

export default async function SetupIntegrationsPage() {
  const user = await getCurrentUser();
  if (!user.twoFactorEnabled) {
    redirect('/setup-two-factor?install=1');
  }
  const [accounts, connections, { environments }] = await Promise.all([
    apiGet<CloudAccount[]>('/cloud/accounts'),
    apiGet<GitConnection[]>('/git/connections'),
    apiGet<EnvironmentAdminView>('/environments/manage'),
  ]);

  return (
    <SyncProgressProvider>
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 py-10">
        <SetupSteps current={4} />
        <div className="text-center">
          <h1 className="text-xl font-semibold tracking-tight">Connect your services</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This step is optional. You can do it later under Settings &gt; Integrations.
          </p>
        </div>
        {CLOUD_PROVIDERS.map((provider) => (
          <Card key={provider.id}>
            <CardHeader title={provider.label} description={provider.description} />
            <Added
              names={accounts.filter((item) => item.provider === provider.id).map(({ name }) => name)}
            />
            <AddCloudAccountForm provider={provider} environments={environments} />
          </Card>
        ))}
        {GIT_PROVIDERS.map((provider) => (
          <Card key={provider.id}>
            <CardHeader title={provider.label} description={provider.description} />
            <Added
              names={connections.filter((item) => item.provider === provider.id).map(({ name }) => name)}
            />
            <AddGitConnectionForm provider={provider} />
          </Card>
        ))}
        <Button asChild variant="primary" className="self-center">
          <Link href="/">Finish setup</Link>
        </Button>
      </main>
    </SyncProgressProvider>
  );
}
