import type { HealthCounts, Resource } from '@pulsegrid/shared';

export const healthLine = ({ degraded, stopped, unknown, total }: HealthCounts): string => {
  if (total === 0) {
    return 'Nothing synced yet';
  }
  if (degraded > 0) {
    return `${degraded} need${degraded === 1 ? 's' : ''} attention`;
  }
  if (stopped > 0) {
    return `No problems, ${stopped} stopped`;
  }
  return unknown > 0 ? `No problems, ${unknown} unknown` : 'Healthy';
};

export type HealthTone = 'success' | 'danger' | 'neutral' | 'warning';

export const healthTone = ({ degraded, stopped, unknown, total }: HealthCounts): HealthTone => {
  if (degraded > 0) {
    return 'danger';
  }
  if (total === 0 || stopped > 0) {
    return 'neutral';
  }
  return unknown > 0 ? 'warning' : 'success';
};

export const addHealth = (totals: HealthCounts, counts: HealthCounts): HealthCounts => ({
  healthy: totals.healthy + counts.healthy,
  degraded: totals.degraded + counts.degraded,
  stopped: totals.stopped + counts.stopped,
  unknown: totals.unknown + counts.unknown,
  total: totals.total + counts.total,
});

export const EMPTY_HEALTH: HealthCounts = {
  healthy: 0,
  degraded: 0,
  stopped: 0,
  unknown: 0,
  total: 0,
};

const HEALTH_ORDER: Resource['health'][] = ['degraded', 'unknown', 'stopped', 'healthy'];

export const byHealthThenName = (first: Resource, second: Resource): number =>
  HEALTH_ORDER.indexOf(first.health) - HEALTH_ORDER.indexOf(second.health) ||
  first.name.localeCompare(second.name);
