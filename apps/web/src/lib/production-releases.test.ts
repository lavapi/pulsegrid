import type { ProductionRelease } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { decisionText, isInFlight, releaseStatus, timeLeft } from './production-releases';

const release = (status: string): ProductionRelease => ({
  id: 'r',
  status,
  components: [],
  requestedBy: null,
  createdAt: null,
  holdStartedAt: null,
  holdUntil: null,
  decision: null,
  decidedBy: null,
  snapshot: null,
});

describe('production releases', () => {
  it('counts down to the automatic rollback', () => {
    const now = Date.parse('2026-11-18T12:28:00Z');
    expect(timeLeft('2026-11-18T17:40:00Z', now)).toBe('5 h 12 min');
    expect(timeLeft('2026-11-18T12:40:00Z', now)).toBe('12 min');
    expect(timeLeft('2026-11-18T12:00:00Z', now)).toBeNull();
  });

  it('names statuses plainly, and shows unknown ones as they are', () => {
    expect(releaseStatus('HOLD')).toEqual({ label: 'Waiting for a decision', tone: 'warning' });
    expect(releaseStatus('PAUSED')).toEqual({ label: 'PAUSED', tone: 'neutral' });
  });

  it('keeps checking until the release has ended', () => {
    expect(isInFlight(release('HOLD'))).toBe(true);
    expect(isInFlight(release('FINISH'))).toBe(true);
    expect(isInFlight(release('SUCCEEDED'))).toBe(false);
    expect(isInFlight(null)).toBe(false);
  });

  it('says who decided what', () => {
    expect(decisionText({ decision: 'ROLLBACK', decidedBy: 'bo@example.test' })).toBe('Rolled back by bo@example.test');
    expect(decisionText({ decision: null, decidedBy: null })).toBeNull();
  });
});
