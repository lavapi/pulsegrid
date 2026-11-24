import { CARD_LOAD_SLOTS, type LoadChart, type LoadSeries, type Resource, type ResourceType } from '@pulsegrid/shared';
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

/** The busiest line and its latest value: one overloaded node, or one full disk, matters more than the average. */
const busiest = (series: readonly LoadSeries[]): { line: LoadSeries; value: number } | null =>
  series.reduce<{ line: LoadSeries; value: number } | null>((highest, line) => {
    const value = latestValue(line);
    return value !== null && (highest === null || value > highest.value) ? { line, value } : highest;
  }, null);

/** Names the part shown, such as a node or a disk, when it isn't the resource as a whole. */
const labelOf = (chart: LoadChart, line: LoadSeries, resourceName: string): string =>
  line.label === resourceName ? chart.label : `${chart.label} · ${line.label}`;

const meterOf = (chart: LoadChart, resourceName: string): CardMeter | null => {
  const found = busiest(chart.series);
  if (!found) {
    return null;
  }
  const { line, value } = found;
  const ceiling = ceilingOf(chart);
  const share = ceiling ? Math.min(1, Math.max(0, value / ceiling)) : null;
  const percent = share !== null && chart.unit !== 'percent' ? ` · ${formatLoadValue(share * 100, 'percent')}` : '';
  return {
    label: labelOf(chart, line, resourceName),
    reading: `${formatReading(value, chart)}${percent}`,
    share,
    warn: isNearLimit(chart),
  };
};

/** One meter per slot the card shows, from the first chart in the slot that has a reading. */
export const cardMeters = (
  { type, name }: Pick<Resource, 'type' | 'name'>,
  charts: readonly LoadChart[],
): CardMeter[] =>
  (CARD_LOAD_SLOTS[type] ?? []).flatMap((slot) => {
    for (const id of slot) {
      const chart = charts.find((item) => item.id === id);
      const meter = chart ? meterOf(chart, name) : null;
      if (meter) {
        return [meter];
      }
    }
    return [];
  });

const AGENT_CHARTS = ['memory', 'disk'];
const NEEDS_AGENT = 'Memory and disk need the CloudWatch agent on the server.';

/** Why a card shows less than usual, such as a server that doesn't send memory or disk use. */
export const cardHint = (type: ResourceType, charts: readonly LoadChart[]): string | null =>
  type === 'ec2-instance' && !charts.some(({ id }) => AGENT_CHARTS.includes(id)) ? NEEDS_AGENT : null;

/** Ids split into requests the API accepts. */
export const cardLoadBatches = (ids: readonly string[], size: number): string[][] =>
  Array.from({ length: Math.ceil(ids.length / size) }, (_, index) => ids.slice(index * size, (index + 1) * size));
