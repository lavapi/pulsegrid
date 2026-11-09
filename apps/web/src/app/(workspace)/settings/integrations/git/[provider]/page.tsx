import { type GitConnection, gitProvider, hasPermission } from '@pulsegrid/shared';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AddGitConnectionForm } from '@/components/integrations/add-git-connection-form';
import { GitConnectionCard } from '@/components/integrations/git-connection-card';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet, getCurrentUser } from '@/lib/server-api';

export default async function GitIntegrationPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const provider = gitProvider((await params).provider);
  if (!provider) {
    notFound();
  }
  const user = await getCurrentUser();
  if (!hasPermission(user, 'integrations.manage')) {
    redirect('/');
  }
  const connections = await apiGet<GitConnection[]>('/git/connections');
  const own = connections.filter((connection) => connection.provider === provider.id);

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
      {own.map((connection) => (
        <GitConnectionCard
          connection={connection}
          fields={provider.credentialFields}
          key={connection.id}
        />
      ))}
      <Card>
        <CardHeader
          title={`Add ${provider.label} connection`}
          description="Test the credentials before saving. Add one connection for each organization."
        />
        <AddGitConnectionForm provider={provider} />
      </Card>
      <Card>
        <CardHeader
          title={provider.setup.title}
          description={provider.setup.description}
          action={<CopyButton value={provider.setup.code} label="Copy" />}
        />
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-5 text-xs">
          {provider.setup.code}
        </pre>
      </Card>
    </>
  );
}
