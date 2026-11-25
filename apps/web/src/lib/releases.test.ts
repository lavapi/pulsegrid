import type { Release, ReleaseState } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { decodeChoice, encodeChoice, readyLabel, releaseCounts, releaseStateView } from './releases';

const release = (state: ReleaseState) => ({ state }) as Release;

describe('releases', () => {
  it('counts what is moving, ready and failed', () => {
    const states: ReleaseState[] = ['building', 'deploying', 'ready', 'failed', 'cancelled', 'idle'];
    expect(releaseCounts(states.map(release))).toEqual({ inProgress: 2, ready: 1, failed: 1 });
  });

  it('keeps service IDs that contain separators intact', () => {
    const parts = ['id', 'arn:aws:ecs:eu-central-1:1:service/main|api/x'];
    expect(decodeChoice(encodeChoice(...parts))).toEqual(parts);
  });
});

describe('releaseStateView', () => {
  it('is ready for testing on staging, and only ready on production', () => {
    expect(releaseStateView('ready', false).label).toBe('Ready for testing');
    expect(releaseStateView('ready', true)).toEqual({ label: 'Ready', tone: 'success' });
    expect(releaseStateView('failed', true).label).toBe('Failed');
    expect(readyLabel(true)).toBe('Ready');
  });
});
