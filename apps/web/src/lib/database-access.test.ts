import { describe, expect, it } from 'vitest';
import { canShare, endingOf, progressOf, timeLeft } from './database-access';

describe('timeLeft', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');

  it('shows hours and minutes, then minutes, then nothing once ended', () => {
    expect(timeLeft('2026-11-13T12:05:00Z', now)).toBe('2 h 05 min');
    expect(timeLeft('2026-11-13T10:04:10Z', now)).toBe('5 min');
    expect(timeLeft('2026-11-13T09:59:00Z', now)).toBeNull();
  });
});

describe('canShare', () => {
  it('offers the share sheet only where the browser has one that takes text', () => {
    const share = () => Promise.resolve();
    expect(canShare({ share, canShare: () => true })).toBe(true);
    expect(canShare({ share, canShare: () => false })).toBe(false);
    expect(canShare({ share } as never)).toBe(true);
    expect(canShare({} as never)).toBe(false);
    expect(canShare(undefined)).toBe(false);
  });
});

describe('grant states', () => {
  const grant = {
    id: 'g',
    grantedBy: 'gus@example.test',
    userName: 'pat@example.test',
    userId: 'u1',
    reason: 'Check',
    status: 'active' as const,
    change: null,
    failure: null,
    startsAt: '2026-11-13T10:00:00Z',
    expiresAt: '2026-11-13T12:00:00Z',
    revokedAt: null,
    revokedBy: null,
    endReason: null,
  };

  it('says what AWS is doing, and how a grant ended', () => {
    expect(progressOf({ ...grant, status: 'granting' })).toBe('Granting in AWS, usually 1 to 2 minutes');
    expect(progressOf({ ...grant, change: 'revoking' })).toBe('Revoking in AWS');
    expect(progressOf(grant)).toBeNull();
    expect(endingOf({ ...grant, status: 'revoked', endReason: 'manual', revokedBy: 'gus@example.test' })).toBe(
      'Revoked by gus@example.test',
    );
    expect(endingOf({ ...grant, status: 'expired', endReason: 'expired' })).toBe('Expired');
    expect(endingOf({ ...grant, status: 'failed', failure: 'Not allowed.' })).toBe('Failed: Not allowed.');
  });
});
