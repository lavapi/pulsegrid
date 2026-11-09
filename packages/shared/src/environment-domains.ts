export const DOMAIN_KINDS = ['app', 'grafana'] as const;

export type DomainKind = (typeof DOMAIN_KINDS)[number];

export const DOMAIN_KIND_LABELS: Record<DomainKind, string> = {
  app: 'App',
  grafana: 'Grafana',
};

export const MAX_DOMAIN_LABEL_LENGTH = 40;

export const MAX_DOMAIN_URL_LENGTH = 300;

export interface EnvironmentDomain {
  id: string;
  kind: DomainKind;
  label: string | null;
  url: string;
}
