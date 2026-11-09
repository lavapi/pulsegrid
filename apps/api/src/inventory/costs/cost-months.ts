import type { CostPeriod } from '../providers/provider';

const monthOf = (value: Date): string => value.toISOString().slice(0, 7);

const monthStart = (value: Date, monthsBack: number): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - monthsBack, 1));

export const currentMonth = (now: Date): string => monthOf(now);

export const previousMonth = (now: Date): string => monthOf(monthStart(now, 1));

export const costPeriod = (now: Date): CostPeriod => ({
  from: monthStart(now, 1),
  until: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)),
});
