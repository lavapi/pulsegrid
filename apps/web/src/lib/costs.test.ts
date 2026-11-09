import type { AccountCosts, ServiceCost } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { filteredAccounts, formatMoney, monthName, shownServices, totalsByCurrency } from './costs';

const service = (name: string, thisMonth: number, lastMonth = 0, category: string | null = null): ServiceCost => ({
  service: name,
  category,
  thisMonth,
  lastMonth,
});

const account = (accountId: string, overrides: Partial<AccountCosts> = {}): AccountCosts => ({
  accountId,
  accountName: accountId,
  environmentId: null,
  environmentName: null,
  isProduction: false,
  currency: 'USD',
  services: [],
  updatedAt: null,
  error: null,
  ...overrides,
});

describe('costs', () => {
  it('shows money and month names', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(monthName('2026-11')).toBe('November');
  });

  it('filters by account and environment', () => {
    const accounts = [account('a', { environmentId: 'staging' }), account('b', { environmentId: 'live' })];
    expect(filteredAccounts(accounts, {})).toHaveLength(2);
    expect(filteredAccounts(accounts, { account: 'b' })).toEqual([accounts[1]]);
    expect(filteredAccounts(accounts, { environment: 'staging' })).toEqual([accounts[0]]);
  });

  it('never adds different currencies together', () => {
    const totals = totalsByCurrency([
      account('a', { services: [service('EC2', 1, 2), service('S3', 3)] }),
      account('b', { services: [service('EC2', 10)] }),
      account('c', { currency: 'EUR', services: [service('EC2', 5)] }),
      account('d', { currency: null }),
    ]);
    expect(totals).toEqual([
      { currency: 'USD', thisMonth: 14, lastMonth: 2 },
      { currency: 'EUR', thisMonth: 5, lastMonth: 0 },
    ]);
  });

  it('separates connected services and hides ones that cost nothing', () => {
    const { connected, other } = shownServices([
      service('EC2', 1, 0, 'ec2'),
      service('Tax', 0, 4),
      service('Free', 0.001),
    ]);
    expect(connected.map(({ service: name }) => name)).toEqual(['EC2']);
    expect(other.map(({ service: name }) => name)).toEqual(['Tax']);
  });
});
