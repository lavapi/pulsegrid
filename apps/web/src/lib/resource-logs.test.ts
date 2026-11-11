import { describe, expect, it } from 'vitest';
import { activeTab, formatMs, formatShare, requestLogQuery, resourceTabs, statusTone } from './resource-logs';

describe('resource tabs', () => {
  it('adds a log tab to load balancers and databases only', () => {
    expect(resourceTabs('load-balancer').map(({ id }) => id)).toEqual(['overview', 'requests']);
    expect(resourceTabs('rds-cluster').map(({ label }) => label)).toEqual(['Overview', 'Query activity']);
    expect(resourceTabs('ecs-service')).toEqual([]);
  });

  it('falls back to the overview for a tab the resource lacks', () => {
    expect(activeTab('load-balancer', 'requests')).toBe('requests');
    expect(activeTab('load-balancer', 'queries')).toBe('overview');
    expect(activeTab('ecs-service', undefined)).toBe('overview');
  });
});

describe('request log helpers', () => {
  it('leaves empty filters out of the query', () => {
    expect(requestLogQuery({ from: 'a', to: 'b', host: '', path: '/api', showQuery: false, minResponseMs: 250 })).toBe(
      'from=a&to=b&path=%2Fapi&minResponseMs=250',
    );
  });

  it('formats times, shares and status tones', () => {
    expect(formatMs(null)).toBe('—');
    expect(formatMs(12.4)).toBe('12 ms');
    expect(formatMs(1534)).toBe('1.5 s');
    expect(formatMs(25_000)).toBe('25 s');
    expect(formatShare(0.4567)).toBe('46%');
    expect(formatShare(0.0123)).toBe('1.2%');
    expect(formatShare(0.0004)).toBe('<0.1%');
    expect([statusTone(502), statusTone(404), statusTone(200), statusTone(null)]).toEqual([
      'danger',
      'warning',
      'neutral',
      'neutral',
    ]);
  });
});
