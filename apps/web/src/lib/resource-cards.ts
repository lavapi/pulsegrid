import type { ActionRun, Resource, ServiceCategory } from '@pulsegrid/shared';
import { RESOURCE_COLUMNS } from './service-views';

const CARD_CATEGORIES: readonly ServiceCategory[] = ['ecs', 'rds', 'elasticache', 'ec2'];
const FACTS_PER_CARD = 4;
const EMPTY_VALUE = '—';

export const usesCards = (category: ServiceCategory): boolean => CARD_CATEGORIES.includes(category);

export const cardFacts = (resource: Resource): { label: string; value: string }[] =>
  RESOURCE_COLUMNS[resource.type]
    .map(({ label, value }) => ({ label, value: value(resource) }))
    .filter(({ value }) => value && value !== EMPTY_VALUE)
    .slice(0, FACTS_PER_CARD);

export const runsByResource = (runs: readonly ActionRun[]): Map<string, ActionRun> =>
  new Map(runs.map((run) => [run.resourceId, run]));

export const justFinished = (before: readonly ActionRun[], after: readonly ActionRun[]): boolean => {
  const current = runsByResource(after);
  return before.some(({ id, status }) => {
    const next = [...current.values()].find((run) => run.id === id);
    return status === 'running' && next?.status !== 'running';
  });
};
