import { isSyncRunning, type SyncProgress } from '@pulsegrid/shared';

const PHASE_TITLES = {
  queued: 'Waiting for the sync to start',
  reading: 'Syncing your AWS accounts',
} as const;

export const syncTitle = ({ phase, message }: SyncProgress): string =>
  phase === 'finished' || phase === 'failed' ? (message ?? 'Sync finished') : PHASE_TITLES[phase];

export const isAccountSyncing = (syncs: readonly SyncProgress[], accountId: string): boolean =>
  syncs.some((sync) => sync.accountId === accountId && isSyncRunning(sync));

export const syncId = ({ key, startedAt }: SyncProgress): string => `${key}:${startedAt}`;

export const visibleSyncs = (
  syncs: readonly SyncProgress[],
  dismissed: readonly string[],
): SyncProgress[] => syncs.filter((sync) => !dismissed.includes(syncId(sync)));
