import {
  EXPERIMENT_RUN_LIMIT,
  type ExperimentCapacity,
  type ExperimentState,
  LOAD_WINDOW_MAX_MINUTES,
  type LoadWindow,
  type RunResult,
} from '@pulsegrid/shared';

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

export const experimentPath = (region: string, id: string): string => `/failover-tests/${region}/${id}`;

export const experimentRunPath = (id: string): string => `/failover-tests/runs/${id}`;

export const reportPath = (id: string): string => `/failover-tests/reports/${id}`;

export const HISTORY_PATH = '/failover-tests/history';

/** A run page for a history entry, which may belong to another account than the one selected. */
export const historyRunPath = (id: string, accountId: string): string =>
  `${experimentRunPath(id)}?account=${encodeURIComponent(accountId)}`;

const RESULTS: Record<RunResult, { label: string; tone: Tone }> = {
  passed: { label: 'Passed', tone: 'success' },
  stopped: { label: 'Stopped', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  running: { label: 'Running', tone: 'warning' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

export const resultLabel = (result: RunResult): string => RESULTS[result].label;

export const resultTone = (result: RunResult): Tone => RESULTS[result].tone;

export const formatDuration = (from: string | null, to: string | null): string | null => {
  if (!from || !to) {
    return null;
  }
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  if (minutes < 1) {
    return 'under 1 min';
  }
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};

const MARGIN_MS = 10 * 60_000;

/** The test's time with 10 minutes either side, so the load before and after shows too. */
export const reportWindow = (from: string | null, to: string | null, now = new Date()): LoadWindow | null => {
  if (!from) {
    return null;
  }
  const start = Date.parse(from) - MARGIN_MS;
  const end = Math.min((to ? Date.parse(to) : now.getTime()) + MARGIN_MS, now.getTime());
  const longest = start + LOAD_WINDOW_MAX_MINUTES * 60_000;
  return { from: new Date(start).toISOString(), to: new Date(Math.min(end, longest)).toISOString() };
};

export interface WaveChoice {
  /** The suggested number of tests at a time. */
  suggested: number;
  /** The most the run may use: the largest quota among its regions, within the run limit and test count. */
  max: number;
  /** Free slots across the run's regions: the smallest quota minus what's running. */
  free: number;
}

/** What the run dialog suggests: the group's last choice, otherwise the free slots, never below 1. */
export const waveChoice = (
  capacity: readonly ExperimentCapacity[],
  regions: readonly string[],
  tests: number,
  remembered: number | null,
): WaveChoice => {
  const relevant = capacity.filter(({ region }) => regions.includes(region));
  const free = relevant.length > 0 ? Math.max(0, Math.min(...relevant.map(({ quota, running }) => quota - running))) : 0;
  const max = Math.max(1, Math.min(EXPERIMENT_RUN_LIMIT, tests, ...relevant.map(({ quota }) => quota)));
  const suggested = Math.min(max, Math.max(1, remembered ?? free));
  return { suggested, max, free };
};
