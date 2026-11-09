import type { ActionRun, Resource } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { cardFacts, justFinished, runsByResource, usesCards } from './resource-cards';

const run = (id: string, resourceId: string, status: ActionRun['status']) =>
  ({ id, resourceId, status }) as ActionRun;

describe('usesCards', () => {
  it('covers services with actions', () => {
    expect(['ecs', 'rds', 'elasticache', 'ec2'].every((item) => usesCards(item as never))).toBe(true);
  });

  it('keeps long lists as tables', () => {
    expect(usesCards('vpc')).toBe(false);
    expect(usesCards('s3')).toBe(false);
  });
});

describe('cardFacts', () => {
  it('shows the useful details of a service', () => {
    const resource = {
      type: 'ecs-service',
      details: { cluster: 'main', launchType: 'FARGATE', desiredTasks: 2, runningTasks: 2 },
    } as unknown as Resource;
    const labels = cardFacts(resource).map(({ label }) => label);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.length).toBeLessThanOrEqual(4);
  });

  it('leaves out empty details', () => {
    const resource = { type: 'ecs-service', details: {} } as unknown as Resource;
    expect(cardFacts(resource).every(({ value }) => value !== '—')).toBe(true);
  });
});

describe('justFinished', () => {
  it('notices a run that ended', () => {
    expect(justFinished([run('a', 'r', 'running')], [run('a', 'r', 'succeeded')])).toBe(true);
  });

  it('notices a run that is gone', () => {
    expect(justFinished([run('a', 'r', 'running')], [])).toBe(true);
  });

  it('ignores runs that are still going', () => {
    expect(justFinished([run('a', 'r', 'running')], [run('a', 'r', 'running')])).toBe(false);
  });

  it('ignores runs that had already finished', () => {
    expect(justFinished([run('a', 'r', 'failed')], [run('a', 'r', 'failed')])).toBe(false);
  });
});

describe('runsByResource', () => {
  it('finds a run by its resource', () => {
    expect(runsByResource([run('a', 'r', 'running')]).get('r')?.id).toBe('a');
  });
});
