import { DOMAIN_KINDS, type DomainKind, type EnvironmentDomain } from '@pulsegrid/shared';
import { ChartLine, ExternalLink, Globe, type LucideIcon } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { DOMAIN_GROUP_TITLES, domainHost, domainLinkLabel, domainName, domainsOfKind } from '@/lib/domains';

export const DOMAIN_ICONS: Record<DomainKind, LucideIcon> = {
  app: Globe,
  grafana: ChartLine,
};

export function DomainIcon({ kind, className }: { kind: DomainKind; className?: string }) {
  const Icon = DOMAIN_ICONS[kind];
  return <Icon className={cn('size-4 shrink-0', className)} aria-hidden="true" />;
}

export function ExternalDomainLink({
  domain,
  className,
  children,
}: {
  domain: EnvironmentDomain;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <a href={domain.url} target="_blank" rel="noopener noreferrer" title={domainHost(domain)} className={className}>
      {children ?? domainLinkLabel(domain)}
    </a>
  );
}

function QuickLinkGroup({ kind, domains }: { kind: DomainKind; domains: readonly EnvironmentDomain[] }) {
  const title = DOMAIN_GROUP_TITLES[kind];
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={title}>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <DomainIcon kind={kind} className="size-3.5" />
        {title}
      </h3>
      {domains.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {domains.map((domain) => (
            <li key={domain.id}>
              <ExternalDomainLink
                domain={domain}
                className="group flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors hover:border-primary/50 hover:bg-muted/40"
              >
                <DomainIcon kind={kind} className="text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{domainName(domain)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{domainHost(domain)}</span>
                </span>
                <ExternalLink className="size-3.5 shrink-0 text-faint group-hover:text-foreground" aria-hidden="true" />
              </ExternalDomainLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">No {title} links yet.</p>
      )}
    </section>
  );
}

export function QuickLinks({
  domains,
  description,
  action,
}: {
  domains: readonly EnvironmentDomain[];
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title="Quick links" description={description} action={action} />
      <div className="grid gap-5 p-5 sm:grid-cols-2">
        {DOMAIN_KINDS.map((kind) => (
          <QuickLinkGroup kind={kind} domains={domainsOfKind(domains, kind)} key={kind} />
        ))}
      </div>
    </Card>
  );
}
