import type { LoadChart, LoadSeries, LoadUnit } from '@pulsegrid/shared';

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
const BYTE_STEP = 1024;

const trimmed = (value: number, digits: number): string =>
  new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits }).format(value);

const formatBytes = (value: number): string => {
  let size = value;
  let index = 0;
  while (Math.abs(size) >= BYTE_STEP && index < BYTE_UNITS.length - 1) {
    size /= BYTE_STEP;
    index += 1;
  }
  return `${trimmed(size, size < 10 ? 1 : 0)} ${BYTE_UNITS[index]}`;
};

export const formatLoadValue = (value: number, unit: LoadUnit): string => {
  switch (unit) {
    case 'percent':
      return `${trimmed(value, value < 10 ? 1 : 0)}%`;
    case 'bytes':
      return formatBytes(value);
    case 'milliseconds':
      return `${trimmed(value, value < 10 ? 2 : 0)} ms`;
    case 'count':
      return trimmed(value, value < 10 ? 1 : 0);
  }
};

export const latestValue = ({ points }: LoadSeries): number | null => points.at(-1)?.value ?? null;

export const isNearLimit = (chart: LoadChart): boolean =>
  chart.warnAbove !== null &&
  chart.series.some((series) => (latestValue(series) ?? 0) > (chart.warnAbove ?? Number.POSITIVE_INFINITY));

/** The top of the chart: the limit when there is one, otherwise a little above the highest value. */
export const chartCeiling = ({ limit, series }: LoadChart): number => {
  if (limit !== null) {
    return limit;
  }
  const highest = Math.max(0, ...series.flatMap(({ points }) => points.map(({ value }) => value)));
  return highest === 0 ? 1 : highest * 1.15;
};

export const chartTimestamps = ({ series }: LoadChart): string[] =>
  [...new Set(series.flatMap(({ points }) => points.map(({ timestamp }) => timestamp)))].sort();

export const valueAt = ({ points }: LoadSeries, timestamp: string): number | null =>
  points.find((point) => point.timestamp === timestamp)?.value ?? null;
