import type { ExperimentRunItem, TouchedResource } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { NOTES, planWave, type RegionRoom, sharingCount } from './wave-plan';

const REGION = 'eu-central-1';
const db: TouchedResource = { key: 'rds-instance|db-1', name: 'staging-db' };
const anyDb: TouchedResource = { key: 'rds-instance|*', name: 'any rds db' };
const cache: TouchedResource = { key: 'elasticache-replication-group|c-1', name: 'staging-cache' };

const item = (overrides: Partial<ExperimentRunItem>): ExperimentRunItem => ({
  region: REGION,
  templateId: 'T',
  label: 'Test',
  experimentId: null,
  error: null,
  waiting: true,
  resources: [],
  ...overrides,
});
const rooms = (slots: number, active: string[] = []): Map<string, RegionRoom> =>
  new Map([[REGION, { slots, activeIds: new Set(active) }]]);

describe('planWave', () => {
  it('starts tests on different resources together, within the slots', () => {
    const plan = planWave([item({ resources: [db] }), item({ resources: [cache] }), item({ resources: [] })], rooms(2));
    expect(plan.start).toEqual([0, 1]);
    expect(plan.notes.get(2)).toBe(NOTES.slot);
  });

  it('never starts two tests on the same resource at once', () => {
    const plan = planWave([item({ resources: [db] }), item({ resources: [db] })], rooms(5));
    expect(plan.start).toEqual([0]);
    expect(plan.notes.get(1)).toBe('Waiting for the test on staging-db to finish.');
  });

  it('treats a test that could pick any database as clashing with every database test', () => {
    const plan = planWave([item({ resources: [anyDb] }), item({ resources: [db] })], rooms(5));
    expect(plan.start).toEqual([0]);
  });

  it('waits while a test on the resource runs, and while the resource recovers after it', () => {
    const running = item({ waiting: false, experimentId: 'E1', resources: [db] });
    expect(planWave([running, item({ resources: [db] })], rooms(5, ['E1'])).notes.get(1)).toBe(
      'Waiting for the test on staging-db to finish.',
    );
    const ended = { ...running, endedAt: '2026-11-11T10:00:00Z' };
    expect(planWave([ended, item({ resources: [db] })], rooms(5)).notes.get(1)).toBe('Waiting for staging-db to recover.');
    expect(planWave([{ ...ended, recovered: true }, item({ resources: [db] })], rooms(5)).start).toEqual([1]);
  });

  it('cancels tests waiting for a resource that never recovered', () => {
    const failed = item({ waiting: false, experimentId: 'E1', resources: [db], endedAt: 'x', recovered: false });
    const plan = planWave([failed, item({ resources: [db] }), item({ resources: [cache] })], rooms(5));
    expect(plan.cancel.get(1)).toBe("Cancelled: staging-db didn't recover within 30 minutes.");
    expect(plan.start).toEqual([2]);
  });

  it('runs zone-wide tests last, one at a time, with nothing else running', () => {
    const zoneA = item({ zoneWide: true, label: 'zone-outage' });
    const zoneB = item({ zoneWide: true, label: 'zone-network-cut' });
    const first = planWave([zoneA, item({ resources: [db] }), zoneB], rooms(5));
    expect(first.start).toEqual([1]);
    expect(first.notes.get(0)).toBe(NOTES.zoneLast);

    const others = item({ waiting: false, experimentId: 'E1', resources: [db], endedAt: 'x', recovered: true });
    const second = planWave([zoneA, others, zoneB], rooms(5));
    expect(second.start).toEqual([0]);
    expect(second.notes.get(2)).toBe(NOTES.zoneLast);

    const zoneRunning = { ...zoneA, waiting: false, experimentId: 'Z1' };
    expect(planWave([zoneRunning, others, zoneB], rooms(5, ['Z1'])).notes.get(2)).toBe(NOTES.zoneLast);
    expect(planWave([{ ...zoneRunning, endedAt: 'x', recovered: true }, others, zoneB], rooms(5)).start).toEqual([2]);
  });
});

describe('sharingCount', () => {
  it('counts tests that share a resource with another test, leaving zone-wide tests out', () => {
    expect(
      sharingCount([{ resources: [db] }, { resources: [anyDb] }, { resources: [cache] }, { resources: [], zoneWide: true }]),
    ).toBe(2);
  });
});
