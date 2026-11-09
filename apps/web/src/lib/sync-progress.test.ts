import type { SyncProgress } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { isAccountSyncing, syncTitle, visibleSyncs } from './sync-progress';

const sync = (overrides: Partial<SyncProgress> = {}): SyncProgress => ({
  key: 'k',
  accountId: 'a',
  phase: 'reading',
  percent: 10,
  accounts: [],
  message: null,
  startedAt: 'now',
  ...overrides,
});

describe('syncTitle', () => {
  it('describes each running phase', () => {
    expect(syncTitle(sync({ phase: 'queued' }))).toBe('Waiting for the sync to start');
  });

  it('uses the final message once it has ended', () => {
    expect(syncTitle(sync({ phase: 'failed', message: 'Session expired' }))).toBe('Session expired');
  });
});

describe('isAccountSyncing', () => {
  it('matches a running sync of that account only', () => {
    const syncs = [sync({ accountId: 'a' }), sync({ accountId: 'b', phase: 'finished' })];
    expect(isAccountSyncing(syncs, 'a')).toBe(true);
    expect(isAccountSyncing(syncs, 'b')).toBe(false);
  });
});

describe('visibleSyncs', () => {
  it('hides dismissed syncs, but shows a newer run', () => {
    const syncs = [sync({ startedAt: 'old' }), sync({ startedAt: 'new' })];
    expect(visibleSyncs(syncs, ['k:old']).map(({ startedAt }) => startedAt)).toEqual(['new']);
  });
});
