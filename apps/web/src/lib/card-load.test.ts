import type { LoadChart } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { cardMeters } from './card-load';

const GB = 1024 ** 3;

const chart = (id: string, label: string, values: number[], extra: Partial<LoadChart> = {}): LoadChart => ({
  id,
  label,
  unit: 'percent',
  limit: null,
  warnAbove: null,
  total: null,
  note: null,
  series: [{ label: 'db', points: values.map((value, index) => ({ timestamp: `2026-11-20T10:0${index}:00Z`, value })) }],
  ...extra,
});

const cpu = chart('cpu', 'CPU', [12, 5], { limit: 100, warnAbove: 80 });
const connections = chart('connections', 'Connections', [6], { unit: 'count', total: 1802, limit: 1802, warnAbove: 1441.6 });
const working = (used: number) =>
  chart('memory', 'Working memory', [used], { unit: 'bytes', total: 5.5 * GB, limit: 5.5 * GB, warnAbove: 4.95 * GB });

describe('cardMeters', () => {
  it('shows the latest CPU, connections and working memory, in that order', () => {
    expect(cardMeters({ charts: [working(3.2 * GB), chart('read-latency', 'Read latency', [1]), connections, cpu] })).toEqual([
      { label: 'CPU', reading: '5%', share: 0.05, warn: false },
      { label: 'Connections', reading: '6 / 1,802 · 0.3%', share: 6 / 1802, warn: false },
      { label: 'Working memory', reading: '3.2 GB / 5.5 GB · 58%', share: 3.2 / 5.5, warn: false },
    ]);
  });

  it('warns above the same level the instance page does', () => {
    const [memory] = cardMeters({ charts: [working(5.2 * GB)] });
    expect(memory?.warn).toBe(true);
  });

  it('shows free memory without a bar when memory in use is unknown', () => {
    const free = chart('free-memory', 'Free memory', [2.3 * GB], { unit: 'bytes' });
    expect(cardMeters({ charts: [free] })).toEqual([{ label: 'Free memory', reading: '2.3 GB', share: null, warn: false }]);
  });

  it('skips charts with no points yet', () => {
    expect(cardMeters({ charts: [chart('cpu', 'CPU', [], { limit: 100 })] })).toEqual([]);
  });
});
