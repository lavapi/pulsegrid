import type { AccountCosts, ServiceCost } from '@pulsegrid/shared';

const SMALLEST_SHOWN = 0.005;

export interface CostFilters {
  account?: string | undefined;
  environment?: string | undefined;
}

export interface CostTotal {
  currency: string;
  thisMonth: number;
  lastMonth: number;
}

export const formatMoney = (amount: number, currency: string): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);

export const monthName = (month: string): string =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01`));

export const filteredAccounts = (
  accounts: readonly AccountCosts[],
  { account, environment }: CostFilters,
): AccountCosts[] =>
  accounts.filter(
    ({ accountId, environmentId }) =>
      (!account || accountId === account) && (!environment || environmentId === environment),
  );

const sumOf = (services: readonly ServiceCost[], month: 'thisMonth' | 'lastMonth'): number =>
  services.reduce((total, service) => total + service[month], 0);

export const totalsByCurrency = (accounts: readonly AccountCosts[]): CostTotal[] => {
  const totals = new Map<string, CostTotal>();
  for (const { currency, services } of accounts) {
    if (currency) {
      const total = totals.get(currency) ?? { currency, thisMonth: 0, lastMonth: 0 };
      totals.set(currency, {
        currency,
        thisMonth: total.thisMonth + sumOf(services, 'thisMonth'),
        lastMonth: total.lastMonth + sumOf(services, 'lastMonth'),
      });
    }
  }
  return [...totals.values()];
};

export const shownServices = (services: readonly ServiceCost[]) => {
  const billed = services.filter(
    ({ thisMonth, lastMonth }) =>
      Math.abs(thisMonth) >= SMALLEST_SHOWN || Math.abs(lastMonth) >= SMALLEST_SHOWN,
  );
  return {
    connected: billed.filter(({ category }) => category !== null),
    other: billed.filter(({ category }) => category === null),
  };
};
