import type { CloudAccount } from '@pulsegrid/shared';

export const selectedAccountCookie = (projectId: string): string => `devdash_account_${projectId}`;

export const selectableAccounts = (accounts: readonly CloudAccount[]): CloudAccount[] =>
  accounts.filter(({ status }) => status === 'connected');

export const pickAccount = (
  accounts: readonly CloudAccount[],
  selectedId: string | undefined,
): CloudAccount | null => accounts.find(({ id }) => id === selectedId) ?? accounts[0] ?? null;

export const selectedFirst = (
  accounts: readonly CloudAccount[],
  selectedId: string | null,
): CloudAccount[] => [
  ...accounts.filter(({ id }) => id === selectedId),
  ...accounts.filter(({ id }) => id !== selectedId),
];

const UNSCOPED_PATHS = ['/costs', '/environments', '/releases', '/settings'];
const SHARED_PIPELINES_ONLY = 'none';

export const followsAccountSwitcher = (pathname: string): boolean =>
  !UNSCOPED_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

export const pathAfterSwitch = (pathname: string): string | null => {
  const segments = pathname.split('/');
  const [, section, service, resource] = segments;
  if (section === 'pipelines' && service === 'apps' && resource && segments.length > 4) {
    return `/pipelines/apps/${resource}`;
  }
  if (section === 'failover-tests' && service === 'history') {
    return '/failover-tests/history';
  }
  if (section === 'failover-tests' && service) {
    return '/failover-tests';
  }
  return section === 'infrastructure' && service && resource ? `/infrastructure/${service}` : null;
};

export const pipelineScope = (account: CloudAccount | null): Record<string, string> =>
  account ? { environment: account.environmentId ?? SHARED_PIPELINES_ONLY } : {};
