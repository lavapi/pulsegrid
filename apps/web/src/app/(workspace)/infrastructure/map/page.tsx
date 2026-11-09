import type { InfrastructureMap } from '@pulsegrid/shared';
import { ArrowLeft, Network, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { InfrastructureMapView } from '@/components/infrastructure-map/infrastructure-map-view';
import { NoAccountsState } from '@/components/no-accounts-state';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { getAccountContext } from '@/lib/account-context';
import { withQuery } from '@/lib/infrastructure-filters';
import { apiGet } from '@/lib/server-api';

export default async function InfrastructureMapPage() {
  const { selected } = await getAccountContext();
  if (!selected) {
    return <NoAccountsState />;
  }
  const map = await apiGet<InfrastructureMap>(
    withQuery('/resources/map', new URLSearchParams({ account: selected.id })),
  );
  const linked = map.edges.length > 0 || map.groups.length > 0;

  return (
    <>
      <Link
        href="/infrastructure"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Infrastructure
      </Link>
      <PageHeader title="Infrastructure map" description={`How ${selected.name} fits together`} />
      {map.truncated && (
        <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-3 py-2.5 text-[13px] text-warning" role="status">
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          This account is too large to show in full, so some resources are missing.
        </p>
      )}
      {map.nodes.length > 0 && !linked && (
        <p className="text-[13px] text-muted-foreground">
          Connections appear after the next sync of this account.
        </p>
      )}
      {map.nodes.length > 0 ? (
        <InfrastructureMapView map={map} />
      ) : (
        <EmptyState
          icon={Network}
          title="Nothing to show yet"
          description="No services you can see were found in this account."
        />
      )}
    </>
  );
}
