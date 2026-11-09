import type { LogLine } from '@pulsegrid/shared';

const MAX_LINES = 1000;
const ERROR_PATTERN = /\b(error|fatal|exception|panic|critical)\b/i;
const WARNING_PATTERN = /\bwarn(ing)?\b/i;

export type LineSeverity = 'error' | 'warning' | 'normal';

export const lineSeverity = (message: string): LineSeverity => {
  if (ERROR_PATTERN.test(message)) {
    return 'error';
  }
  return WARNING_PATTERN.test(message) ? 'warning' : 'normal';
};

export const mergeLines = (current: readonly LogLine[], next: readonly LogLine[]): LogLine[] => {
  const seen = new Set(current.map(({ id }) => id));
  return [...current, ...next.filter(({ id }) => !seen.has(id))].slice(-MAX_LINES);
};
