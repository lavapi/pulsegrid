import type { DatabaseAccessGrant } from '@pulsegrid/shared';

const MS_PER_MINUTE = 60_000;

/** Time left as "2 h 05 min" or "4 min", or null once it has ended. */
export const timeLeft = (expiresAt: string, now: number): string | null => {
  const minutes = Math.ceil((Date.parse(expiresAt) - now) / MS_PER_MINUTE);
  if (minutes <= 0) {
    return null;
  }
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${String(minutes % 60).padStart(2, '0')} min` : `${minutes} min`;
};

export const STATUS_LABELS: Record<DatabaseAccessGrant['status'], string> = {
  granting: 'Granting',
  active: 'Active',
  revoked: 'Revoked',
  expired: 'Expired',
  failed: 'Failed',
};

/** What a grant is doing now, while AWS works on it. */
export const progressOf = ({ status, change }: DatabaseAccessGrant): string | null => {
  if (status === 'granting') {
    return 'Granting in AWS, usually 1 to 2 minutes';
  }
  if (change === 'extending') {
    return 'Extending in AWS';
  }
  return change === 'revoking' ? 'Revoking in AWS' : null;
};

/** How a grant in the history ended. */
export const endingOf = ({ status, endReason, revokedBy, failure }: DatabaseAccessGrant): string => {
  if (status === 'failed') {
    return `Failed: ${failure ?? 'unknown reason'}`;
  }
  const how = endReason === 'manual' ? 'Revoked' : 'Expired';
  return `${how}${revokedBy ? ` by ${revokedBy}` : ''}${failure ? `. ${failure}` : ''}`;
};

/** Whether the browser can open the system share sheet with text. */
export const canShare = (navigator: Pick<Navigator, 'share' | 'canShare'> | undefined): boolean =>
  typeof navigator?.share === 'function' &&
  (typeof navigator.canShare !== 'function' || navigator.canShare({ text: 'x' }));
