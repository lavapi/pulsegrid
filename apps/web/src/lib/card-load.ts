import { CARD_LOAD_SLOTS, type LoadChart, type LoadSeries, type ResourceType } from '@pulsegrid/shared';
import { formatLoadValue, formatReading, isNearLimit, latestValue } from './load';

/** Whether this kind of resource shows its latest load on its card. */
export const hasCardLoad = (type: ResourceType): boolean => Boolean(CARD_LOAD_SLOTS[type]);

export interface CardMeter {
  label: string;
  reading: string;
  /** How full, from 0 to 1, when the chart has a ceiling. */
  share: number | null;
  warn: boolean;
}

const ceilingOf = ({ total, limit }: LoadChart): number | null => total ?? limit;

/** The latest value of the busiest line, since one overloaded node matters more than the average. */
const busiest = (series: readonly LoadSeries[]): number | null =>
  series.reduce<number | null>((highest, line) => {
    const value = latestValue(line);
    return value === null ? highest : Math.max(highest ?? value, value);
  }, null);

const meterOf = (chart: LoadChart): CardMeter | null => {
  const value = busiest(chart.series);
  if (value === null) {
    return null;
  }
  const ceiling = ceilingOf(chart);
  const share = ceiling ? Math.min(1, Math.max(0, value / ceiling)) : null;
  const percent = share !== null && chart.unit !== 'percent' ? ` · ${formatLoadValue(share * 100, 'percent')}` : '';
  const label = chart.series.length > 1 ? `${chart.label} · busiest node` : chart.label;
  return { label, reading: `${formatReading(value, chart)}${percent}`, share, warn: isNearLimit(chart) };
};

/** One meter per slot the card shows, from the first chart in the slot that has a reading. */
export const cardMeters = (type: ResourceType, charts: readonly LoadChart[]): CardMeter[] =>
  (CARD_LOAD_SLOTS[type] ?? []).flatMap((slot) => {
    for (const id of slot) {
      const chart = charts.find((item) => item.id === id);
      const meter = chart ? meterOf(chart) : null;
      if (meter) {
        return [meter];
      }
    }
    return [];
  });

/** Ids split into requests the API accepts. */
export const cardLoadBatches = (ids: readonly string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(ids.length / size) }, (_, index) => ids.slice(index * size, (index + 1) * size));
