import type { LoadChart, ResourceLoad, ResourceType } from '@pulsegrid/shared';
import { formatLoadValue, formatReading, isNearLimit, latestValue } from './load';

/** Resources whose cards show their latest load. */
export const CARD_LOAD_TYPES: readonly ResourceType[] = ['rds-instance'];

/** The charts a card shows, in order; free memory stands in when memory in use can't be worked out. */
const CARD_CHARTS = ['cpu', 'connections', 'memory', 'free-memory'];

export interface CardMeter {
  label: string;
  reading: string;
  /** How full, from 0 to 1, when the chart has a ceiling. */
  share: number | null;
  warn: boolean;
}

const ceilingOf = ({ total, limit }: LoadChart): number | null => total ?? limit;

const meterOf = (chart: LoadChart): CardMeter | null => {
  const series = chart.series[0];
  const value = series ? latestValue(series) : null;
  if (value === null) {
    return null;
  }
  const ceiling = ceilingOf(chart);
  const share = ceiling ? Math.min(1, Math.max(0, value / ceiling)) : null;
  const percent = share !== null && chart.unit !== 'percent' ? ` · ${formatLoadValue(share * 100, 'percent')}` : '';
  return { label: chart.label, reading: `${formatReading(value, chart)}${percent}`, share, warn: isNearLimit(chart) };
};

/** The latest CPU, connections and memory, as the card shows them. */
export const cardMeters = ({ charts }: Pick<ResourceLoad, 'charts'>): CardMeter[] =>
  CARD_CHARTS.flatMap((id) => {
    const chart = charts.find((item) => item.id === id);
    const meter = chart ? meterOf(chart) : null;
    return meter ? [meter] : [];
  });
