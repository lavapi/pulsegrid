import { describe, expect, it } from 'vitest';
import { costPeriod, currentMonth, previousMonth } from './cost-months';
import { isCostRefreshDue } from './cost-refresh.service';

describe('cost months', () => {
  it('covers last month through today', () => {
    const { from, until } = costPeriod(new Date('2026-11-06T12:00:00Z'));
    expect(from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(until.toISOString()).toBe('2026-11-07T00:00:00.000Z');
  });

  it('crosses the end of a month and a year', () => {
    const now = new Date('2026-01-31T23:00:00Z');
    expect(currentMonth(now)).toBe('2026-01');
    expect(previousMonth(now)).toBe('2025-12');
    expect(costPeriod(now).until.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('when costs refresh', () => {
  const now = new Date('2026-11-06T12:00:00Z');
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

  it('runs for a new account', () => {
    expect(isCostRefreshDue({ costs_checked_at: null, costs_error: null }, now)).toBe(true);
  });

  it('waits about 6 hours after a success', () => {
    expect(isCostRefreshDue({ costs_checked_at: hoursAgo(5), costs_error: null }, now)).toBe(false);
    expect(isCostRefreshDue({ costs_checked_at: hoursAgo(6), costs_error: null }, now)).toBe(true);
  });

  it('tries again within the hour after a failure', () => {
    expect(isCostRefreshDue({ costs_checked_at: hoursAgo(1), costs_error: 'no' }, now)).toBe(true);
    expect(isCostRefreshDue({ costs_checked_at: hoursAgo(0.5), costs_error: 'no' }, now)).toBe(false);
  });
});
