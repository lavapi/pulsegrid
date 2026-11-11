import type { LoadChart } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { chartCeiling, chartTimestamps, formatLoadValue, formatReading, isNearLimit, valueAt } from './load';

const chart = (overrides: Partial<LoadChart> = {}): LoadChart => ({
  id: 'cpu',
  label: 'CPU',
  unit: 'percent',
  limit: 100,
  warnAbove: 80,
  total: null,
  note: null,
  series: [
    {
      label: 'db',
      points: [
        { timestamp: '2026-11-10T10:00:00.000Z', value: 40 },
        { timestamp: '2026-11-10T10:01:00.000Z', value: 50 },
      ],
    },
  ],
  ...overrides,
});

describe('formatLoadValue', () => {
  it.each([
    [42.4, 'percent', '42%'],
    [3.25, 'percent', '3.3%'],
    [1536 * 1024 * 1024, 'bytes', '1.5 GB'],
    [512, 'bytes', '512 B'],
    [1.234, 'milliseconds', '1.23 ms'],
    [1234.5, 'count', '1,235'],
  ] as const)('formats %s %s', (value, unit, expected) => {
    expect(formatLoadValue(value, unit)).toBe(expected);
  });
});

describe('isNearLimit', () => {
  it('looks at the latest value only', () => {
    expect(isNearLimit(chart())).toBe(false);
    const high = chart({ series: [{ label: 'db', points: [{ timestamp: 't', value: 91 }] }] });
    expect(isNearLimit(high)).toBe(true);
  });

  it('never warns without a threshold', () => {
    expect(isNearLimit(chart({ warnAbove: null }))).toBe(false);
  });
});

describe('chartCeiling', () => {
  it('uses the limit, or a margin above the highest value', () => {
    expect(chartCeiling(chart())).toBe(100);
    expect(chartCeiling(chart({ limit: null }))).toBeCloseTo(57.5);
    expect(chartCeiling(chart({ limit: null, series: [] }))).toBe(1);
  });
});

describe('chart points', () => {
  it('lists every timestamp once, in order, and finds values by time', () => {
    const merged = chart({
      series: [
        { label: 'a', points: [{ timestamp: '2026-11-10T10:01:00.000Z', value: 1 }] },
        { label: 'b', points: [{ timestamp: '2026-11-10T10:00:00.000Z', value: 2 }, { timestamp: '2026-11-10T10:01:00.000Z', value: 3 }] },
      ],
    });
    expect(chartTimestamps(merged)).toEqual(['2026-11-10T10:00:00.000Z', '2026-11-10T10:01:00.000Z']);
    expect(valueAt(merged.series[0]!, '2026-11-10T10:00:00.000Z')).toBeNull();
  });
});

describe('formatReading', () => {
  it('shows used / total when the chart has a total', () => {
    const memory = chart({ unit: 'bytes', total: 24 * 1024 ** 3 });
    expect(formatReading(2.5 * 1024 ** 3, memory)).toBe('2.5 GB / 24 GB');
    expect(formatReading(38, chart())).toBe('38%');
  });
});
