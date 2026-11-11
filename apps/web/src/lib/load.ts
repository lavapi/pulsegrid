import { formatBytes, type LoadChart, type LoadSeries, type LoadUnit, trimmedNumber as trimmed } from '@pulsegrid/shared';

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

/** A reading as people expect it: 2.5 GB / 24 GB when the chart has a total, otherwise just the value. */
export const formatReading = (value: number, { unit, total }: Pick<LoadChart, 'unit' | 'total'>): string =>
  total === null ? formatLoadValue(value, unit) : `${formatLoadValue(value, unit)} / ${formatLoadValue(total, unit)}`;

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
