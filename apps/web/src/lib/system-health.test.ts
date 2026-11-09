import { describe, expect, it } from 'vitest';
import { systemStatus } from './system-health';

const NOW = new Date('2026-11-06T12:00:00Z').getTime();
const account = (minutesAgo: number | null, syncIssues: unknown[] = []) =>
  ({
    lastSyncedAt: minutesAgo === null ? null : new Date(NOW - minutesAgo * 60_000).toISOString(),
    syncIssues,
  }) as Parameters<typeof systemStatus>[0];

describe('systemStatus', () => {
  it('is healthy with fresh data and no problems', () => {
    expect(systemStatus(account(1), 0, NOW)).toEqual({
      tone: 'success',
      title: 'All systems healthy',
      detail: null,
    });
  });

  it('counts problems', () => {
    expect(systemStatus(account(1), 1, NOW).title).toBe('1 problem needs attention');
    expect(systemStatus(account(1), 3, NOW)).toMatchObject({ tone: 'danger', title: '3 problems need attention' });
  });

  it('never shows green from stale data', () => {
    expect(systemStatus(account(7), 0, NOW).tone).toBe('warning');
    expect(systemStatus(account(null), 0, NOW).tone).toBe('warning');
  });

  it('warns when part of a sync failed', () => {
    expect(systemStatus(account(1, [{}]), 0, NOW).detail).toContain("couldn't be read");
  });

  it('keeps problems first when data is also stale', () => {
    expect(systemStatus(account(30), 2, NOW)).toMatchObject({ tone: 'danger' });
    expect(systemStatus(account(30), 2, NOW).detail).toContain("hasn't synced");
  });
});
