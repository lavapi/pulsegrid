import type { Release, ReleaseState } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { decodeChoice, encodeChoice, releaseCounts } from './releases';

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
