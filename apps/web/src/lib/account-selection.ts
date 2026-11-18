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

const UNSCOPED_PATHS = [
  '/account',
  '/costs',
  '/environments',
  '/production-releases',
  '/releases',
  '/security-alerts',
  '/settings',
];

/** What pages without the switcher cover instead, where it helps to say so. */
const SCOPE_LABELS: [path: string, label: string][] = [
  ['/costs', 'Across all your accounts'],
  ['/environments', 'Across all your accounts'],
  ['/releases', 'Across all your accounts'],
  ['/security-alerts', 'Across your AWS organization'],
  ['/production-releases', 'Production account'],
];

/** Activity follows the switcher only on its AWS tab; the Dashboard tab is PulseGrid's own log. */
const ACTIVITY_PATH = '/activity';
const AWS_ACTIVITY_VIEW = 'aws';

const isUnder = (pathname: string, path: string): boolean => pathname === path || pathname.startsWith(`${path}/`);
const SHARED_PIPELINES_ONLY = 'none';

export const followsAccountSwitcher = (pathname: string, view: string | null = null): boolean => {
  if (isUnder(pathname, ACTIVITY_PATH)) {
    return view === AWS_ACTIVITY_VIEW;
  }
  return !UNSCOPED_PATHS.some((path) => isUnder(pathname, path));
};

export const scopeLabel = (pathname: string): string | null =>
  SCOPE_LABELS.find(([path]) => isUnder(pathname, path))?.[1] ?? null;

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
