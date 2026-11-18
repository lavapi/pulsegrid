import type { ProductionRelease } from '@pulsegrid/shared';
import type { Tone } from './tone';

export const WAITING_STATUS = 'HOLD';

const STATUSES: Record<string, { label: string; tone: Tone }> = {
  STARTED: { label: 'Starting', tone: 'primary' },
  SWITCH: { label: 'Switching traffic', tone: 'primary' },
  HOLD: { label: 'Waiting for a decision', tone: 'warning' },
  FINISH: { label: 'Finishing', tone: 'primary' },
  SUCCEEDED: { label: 'Finished', tone: 'success' },
  ABORT: { label: 'Rolling back', tone: 'danger' },
  ROLLED_BACK: { label: 'Rolled back', tone: 'danger' },
  FAILED: { label: 'Failed', tone: 'danger' },
};

export const releaseStatus = (status: string): { label: string; tone: Tone } =>
  STATUSES[status] ?? { label: status, tone: 'neutral' };

const ENDED = new Set(['SUCCEEDED', 'ROLLED_BACK', 'FAILED']);

/** Whether the release is still moving, so the page checks on it every 10 seconds. */
export const isInFlight = (release: ProductionRelease | null): boolean => Boolean(release && !ENDED.has(release.status));

export const isWaiting = (release: ProductionRelease): boolean =>
  release.status === WAITING_STATUS && !release.decision;

export const decisionText = ({ decision, decidedBy }: Pick<ProductionRelease, 'decision' | 'decidedBy'>): string | null => {
  if (!decision) return null;
  const what = decision === 'FINISH' ? 'Finished' : 'Rolled back';
  return decidedBy ? `${what} by ${decidedBy}` : what;
};

/** How long until the release rolls back by itself, such as "5 h 12 min". */
export const timeLeft = (until: string, now: number): string | null => {
  const minutes = Math.ceil((new Date(until).getTime() - now) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} h ${rest} min` : `${rest} min`;
};
