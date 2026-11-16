import { KEY_ROTATION_DAYS } from '@pulsegrid/shared';

const DAY_MS = 24 * 60 * 60_000;

/** Whole days since the key was set, or null when PulseGrid doesn't know. */
export const keyAgeDays = (updatedAt: string | null, now: number): number | null =>
  updatedAt ? Math.max(0, Math.floor((now - Date.parse(updatedAt)) / DAY_MS)) : null;

/** Whether a key is old enough that it should be rotated. */
export const isKeyOld = (days: number | null): boolean => days !== null && days >= KEY_ROTATION_DAYS;

export const keyAgeText = (days: number | null): string | null => {
  if (days === null) {
    return null;
  }
  if (days === 0) {
    return 'Key set today';
  }
  return `Key set ${days} ${days === 1 ? 'day' : 'days'} ago`;
};
