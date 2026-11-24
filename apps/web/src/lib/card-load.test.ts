import type { LoadChart } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import type { ResourceType } from '@pulsegrid/shared';
import { cardHint, cardLoadBatches, cardMeters, hasCardLoad } from './card-load';

const GB = 1024 ** 3;
const NAME = 'res';
const of = (type: ResourceType) => ({ type, name: NAME });

const chart = (id: string, label: string, lines: number[][], extra: Partial<LoadChart> = {}): LoadChart => ({
  id,
  label,
  unit: 'percent',
  limit: null,
  warnAbove: null,
  total: null,
  note: null,
  series: lines.map((values, line) => ({
    label: lines.length === 1 ? NAME : `Node 000${line + 1}`,
    points: values.map((value, index) => ({ timestamp: `2026-11-24T10:0${index}:00Z`, value })),
  })),
  ...extra,
});

const percent = (id: string, label: string, lines: number[][], warnAbove: number) =>
  chart(id, label, lines, { limit: 100, warnAbove });

describe('cardMeters', () => {
  it('shows a database its CPU, connections and working memory, in that order', () => {
    const charts = [
      chart('memory', 'Working memory', [[3.2 * GB]], { unit: 'bytes', total: 5.5 * GB, limit: 5.5 * GB, warnAbove: 4.95 * GB }),
      chart('read-latency', 'Read latency', [[1]]),
      chart('connections', 'Connections', [[6]], { unit: 'count', total: 1802, limit: 1802, warnAbove: 1441.6 }),
      percent('cpu', 'CPU', [[12, 5]], 80),
    ];
    expect(cardMeters(of('rds-instance'), charts)).toEqual([
      { label: 'CPU', reading: '5%', share: 0.05, warn: false },
      { label: 'Connections', reading: '6 / 1,802 · 0.3%', share: 6 / 1802, warn: false },
      { label: 'Working memory', reading: '3.2 GB / 5.5 GB · 58%', share: 3.2 / 5.5, warn: false },
    ]);
  });

  it('falls back to free memory, without a bar, when memory in use is unknown', () => {
    const free = chart('free-memory', 'Free memory', [[2.3 * GB]], { unit: 'bytes' });
    expect(cardMeters(of('rds-instance'), [free])).toEqual([{ label: 'Free memory', reading: '2.3 GB', share: null, warn: false }]);
  });

  it('shows a cache its busiest node, named, and warns on any eviction', () => {
    const charts = [
      percent('engine-cpu', 'Engine CPU', [[20], [95]], 90),
      chart('memory', 'Memory used', [[1 * GB], [1.5 * GB]], { unit: 'bytes', total: 4 * GB, limit: 4 * GB, warnAbove: 3.6 * GB }),
      chart('evictions', 'Evictions', [[0], [12]], { unit: 'count', warnAbove: 0 }),
    ];
    expect(cardMeters(of('elasticache-replication-group'), charts)).toEqual([
      { label: 'Engine CPU · Node 0002', reading: '95%', share: 0.95, warn: true },
      { label: 'Memory used · Node 0002', reading: '1.5 GB / 4 GB · 38%', share: 0.375, warn: false },
      { label: 'Evictions · Node 0002', reading: '12', share: null, warn: true },
    ]);
  });

  it("uses a cache's memory share when its byte total can't be worked out", () => {
    const meters = cardMeters(of('elasticache-cluster'), [percent('memory-share', 'Memory used', [[40]], 90)]);
    expect(meters).toEqual([{ label: 'Memory used', reading: '40%', share: 0.4, warn: false }]);
  });

  it('shows a service its CPU and memory out of what its tasks reserve', () => {
    const charts = [
      percent('cpu', 'CPU', [[30]], 80),
      chart('memory', 'Memory used', [[1.2 * GB]], { unit: 'bytes', total: 4 * GB, limit: 4 * GB, warnAbove: 3.6 * GB }),
    ];
    expect(cardMeters(of('ecs-service'), charts).map(({ label, reading }) => `${label}: ${reading}`)).toEqual([
      'CPU: 30%',
      'Memory used: 1.2 GB / 4 GB · 30%',
    ]);
  });

  it('shows a server its CPU, memory and fullest disk, named by its path', () => {
    const disks: LoadChart = {
      ...percent('disk', 'Disk used', [[40], [64]], 85),
      series: [
        { label: '/', points: [{ timestamp: '2026-11-24T10:00:00Z', value: 40 }] },
        { label: '/data', points: [{ timestamp: '2026-11-24T10:00:00Z', value: 64 }] },
      ],
    };
    const charts = [percent('cpu', 'CPU', [[12]], 80), percent('memory', 'Memory used', [[25]], 90), disks];
    expect(cardMeters(of('ec2-instance'), charts).map(({ label, reading }) => `${label}: ${reading}`)).toEqual([
      'CPU: 12%',
      'Memory used: 25%',
      'Disk used · /data: 64%',
    ]);
    expect(cardHint('ec2-instance', charts)).toBeNull();
  });

  it('says a server without the CloudWatch agent can only show CPU', () => {
    const charts = [percent('cpu', 'CPU', [[12]], 80)];
    expect(cardMeters(of('ec2-instance'), charts).map(({ label }) => label)).toEqual(['CPU']);
    expect(cardHint('ec2-instance', charts)).toBe('Memory and disk need the CloudWatch agent on the server.');
    expect(cardHint('rds-instance', charts)).toBeNull();
  });

  it('skips charts with no points yet', () => {
    expect(cardMeters(of('ecs-service'), [percent('cpu', 'CPU', [[]], 80)])).toEqual([]);
  });
});

describe('card load', () => {
  it('is shown for databases, caches, services and servers', () => {
    expect(
      ['rds-instance', 'elasticache-cluster', 'elasticache-replication-group', 'ecs-service', 'ec2-instance'].every((type) =>
        hasCardLoad(type as never),
      ),
    ).toBe(true);
    expect(hasCardLoad('rds-cluster')).toBe(false);
  });

  it('splits many cards into requests the API accepts', () => {
    expect(cardLoadBatches(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    expect(cardLoadBatches([], 2)).toEqual([]);
  });
});
