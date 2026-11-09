import type { CloudAccount } from '@pulsegrid/shared';

const SYNC_INTERVAL_MS = 2 * 60 * 1000;
const MISSED_SYNCS_BEFORE_STALE = 3;
const STALE_AFTER_MS = SYNC_INTERVAL_MS * MISSED_SYNCS_BEFORE_STALE;

export type SystemTone = 'success' | 'warning' | 'danger';

export interface SystemStatus {
  tone: SystemTone;
  title: string;
  detail: string | null;
}

type HealthAccount = Pick<CloudAccount, 'lastSyncedAt' | 'syncIssues'>;

const isStale = ({ lastSyncedAt }: HealthAccount, now: number): boolean =>
  lastSyncedAt === null || now - new Date(lastSyncedAt).getTime() > STALE_AFTER_MS;

const STALE_DETAIL = "This account hasn't synced recently, so this may be out of date.";
const PARTIAL_DETAIL = "Some services couldn't be read at the last sync.";

const detailFor = (account: HealthAccount, now: number): string | null => {
  if (isStale(account, now)) {
    return STALE_DETAIL;
  }
  return account.syncIssues.length > 0 ? PARTIAL_DETAIL : null;
};

export const systemStatus = (account: HealthAccount, problems: number, now: number): SystemStatus => {
  const detail = detailFor(account, now);
  if (problems > 0) {
    const title = `${problems} ${problems === 1 ? 'problem needs' : 'problems need'} attention`;
    return { tone: 'danger', title, detail };
  }
  return detail
    ? { tone: 'warning', title: "We can't confirm everything is healthy", detail }
    : { tone: 'success', title: 'All systems healthy', detail };
};
