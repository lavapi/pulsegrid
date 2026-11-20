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

  it("drops an Aurora member's placeholder storage and per-instance Multi-AZ, but keeps them for standalone databases", () => {
    const database = (details: Record<string, unknown>) =>
      cardFacts({ type: 'rds-instance', details } as unknown as Resource).map(({ label, value }) => `${label}: ${value}`);
    const shared = { engine: 'aurora-postgresql', engineVersion: '18.3', instanceClass: 'db.r7g.large', storageGb: 1, multiAz: false };
    expect(database({ ...shared, cluster: 'app', storageEncrypted: true, publiclyAccessible: false })).toEqual([
      'Engine: aurora-postgresql 18.3',
      'Class: db.r7g.large',
      'Encrypted: Yes',
      'Public: No',
    ]);
    expect(database({ ...shared, engine: 'postgres', storageGb: 100 })).toEqual([
      'Engine: postgres 18.3',
      'Class: db.r7g.large',
      'Storage GB: 100',
      'Multi-AZ: No',
    ]);
  });

  it("names a cluster's writer first", () => {
    const facts = cardFacts({ type: 'rds-cluster', details: { writer: 'app-2', engine: 'aurora-postgresql' } } as unknown as Resource);
    expect(facts[0]).toEqual({ label: 'Writer', value: 'app-2' });
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
