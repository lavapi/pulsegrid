import { DOMAIN_KINDS, type EnvironmentDomain, MAX_DOMAIN_URL_LENGTH } from '@pulsegrid/shared';
import type { TenantTransaction } from '../../database/tenant-context';

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const WEB_PROTOCOLS = ['https:', 'http:'];
const LOCAL_HOST = 'localhost';

const parse = (text: string): URL | null => {
  try {
    return new URL(SCHEME.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
};

const isWebAddress = (url: URL): boolean =>
  WEB_PROTOCOLS.includes(url.protocol) &&
  !url.username &&
  !url.password &&
  (url.hostname.includes('.') || url.hostname === LOCAL_HOST);

export const normalizeDomainUrl = (input: string): string | null => {
  const text = input.trim();
  if (text.length === 0 || text.length > MAX_DOMAIN_URL_LENGTH) {
    return null;
  }
  const url = parse(text);
  if (!url || !isWebAddress(url)) {
    return null;
  }
  return url.pathname === '/' && !url.search && !url.hash ? url.origin : url.href;
};

const kindOrder = ({ kind }: EnvironmentDomain): number => DOMAIN_KINDS.indexOf(kind);

const byKind = (domains: EnvironmentDomain[]): EnvironmentDomain[] =>
  domains.sort((first, second) => kindOrder(first) - kindOrder(second));

const domainRows = (trx: TenantTransaction) =>
  trx
    .selectFrom('environment_domains')
    .select(['id', 'environment_id', 'kind', 'label', 'url'])
    .orderBy('created_at');

export const domainsOf = async (trx: TenantTransaction, environmentId: string): Promise<EnvironmentDomain[]> => {
  const rows = await domainRows(trx).where('environment_id', '=', environmentId).execute();
  return byKind(rows.map(({ environment_id: _, ...domain }) => domain));
};

export const domainsByEnvironment = async (
  trx: TenantTransaction,
): Promise<Map<string, EnvironmentDomain[]>> => {
  const domains = new Map<string, EnvironmentDomain[]>();
  for (const { environment_id: environmentId, ...domain } of await domainRows(trx).execute()) {
    domains.set(environmentId, [...(domains.get(environmentId) ?? []), domain]);
  }
  for (const list of domains.values()) {
    byKind(list);
  }
  return domains;
};
