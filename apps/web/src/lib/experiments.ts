import type { ExperimentState } from '@pulsegrid/shared';

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

const TONES: Record<string, Tone> = {
  pending: 'warning',
  initiating: 'warning',
  running: 'warning',
  stopping: 'warning',
  completed: 'success',
  stopped: 'neutral',
  cancelled: 'neutral',
  skipped: 'neutral',
  failed: 'danger',
};

const DURATION = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

/** Experiment and step states share AWS's words, so one tone map covers both. */
export const stateTone = (state: ExperimentState | string): Tone => TONES[state] ?? 'neutral';

export const stateLabel = (state: string): string => state.charAt(0).toUpperCase() + state.slice(1);

export const formatStepDuration = (duration: string | null): string | null => {
  const match = duration ? DURATION.exec(duration) : null;
  if (!match) {
    return duration;
  }
  const [, hours, minutes, seconds] = match;
  return [hours && `${hours} h`, minutes && `${minutes} min`, seconds && `${seconds} s`].filter(Boolean).join(' ');
};

export const experimentPath = (region: string, id: string): string => `/experiments/${region}/${id}`;
