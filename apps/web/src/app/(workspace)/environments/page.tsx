import type { EnvironmentSummary } from '@pulsegrid/shared';
import { GitCompareArrows, Layers } from 'lucide-react';
import Link from 'next/link';
import { EnvironmentCard } from '@/components/environment-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { apiGet } from '@/lib/server-api';

export default async function EnvironmentsPage() {
  const environments = await apiGet<EnvironmentSummary[]>('/environments');

  return (
    <>
      <PageHeader
        title="Environments"
        description="Health across the environments you can access"
        action={
          environments.length > 1 && (
            <Button asChild>
              <Link href="/environments/compare">
                <GitCompareArrows />
                Compare
              </Link>
            </Button>
          )
        }
      />
      {environments.length > 0 ? (
        <section className="grid grid-cols-[minmax(0,1fr)] gap-3.5 md:grid-cols-2 xl:grid-cols-3" aria-label="Environments">
          {environments.map((environment) => (
            <EnvironmentCard environment={environment} key={environment.id} />
          ))}
        </section>
      ) : (
        <EmptyState
          icon={Layers}
          title="See your environments"
          description="Connect a cloud account to get started. Accounts named like Staging or Production are grouped automatically."
          action={
            <Button asChild variant="primary">
              <Link href="/settings/integrations">Connect a cloud account</Link>
            </Button>
          }
        />
      )}
    </>
  );
}
