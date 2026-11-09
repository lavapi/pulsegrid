import type { DomainKind, EnvironmentDomain } from '@pulsegrid/shared';

export const DOMAIN_GROUP_TITLES: Record<DomainKind, string> = {
  app: 'Apps',
  grafana: 'Grafana',
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export const domainName = ({ kind, label, url }: EnvironmentDomain): string =>
  label ?? (kind === 'grafana' ? 'Grafana' : hostOf(url));

export const domainLinkLabel = (domain: EnvironmentDomain): string => `Open ${domainName(domain)}`;

export const domainHost = ({ url }: EnvironmentDomain): string => hostOf(url);

export const domainsOfKind = (domains: readonly EnvironmentDomain[], kind: DomainKind): EnvironmentDomain[] =>
  domains.filter((domain) => domain.kind === kind);
