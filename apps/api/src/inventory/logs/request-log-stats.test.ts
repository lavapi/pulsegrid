import type { RequestLogEntry } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { requestMatcher, shown } from './request-log-filter';
import { RequestStatsCollector } from './request-log-stats';

const entry = (overrides: Partial<RequestLogEntry>): RequestLogEntry => ({
  time: '2026-11-11T10:00:00.000000Z',
  host: 'api.example.com',
  method: 'GET',
  path: '/v1/players?email=a@example.com',
  elbStatus: 200,
  targetStatus: 200,
  responseMs: 20,
  service: 'game-api',
  userAgent: 'okhttp/4.12',
  edgeIp: '172.70.1.9',
  protocol: 'HTTP/2.0',
  ...overrides,
});

describe('requestMatcher', () => {
  const range = { from: 'a', to: 'b' };

  it('matches status classes and exact codes', () => {
    expect(requestMatcher({ ...range, status: '5xx' })(entry({ elbStatus: 502 }))).toBe(true);
    expect(requestMatcher({ ...range, status: '5xx' })(entry({}))).toBe(false);
    expect(requestMatcher({ ...range, status: '404' })(entry({ elbStatus: 404, targetStatus: null }))).toBe(true);
  });

  it('matches text case-insensitively, and paths without their query unless it is shown', () => {
    expect(requestMatcher({ ...range, host: 'API.EXAMPLE', userAgent: 'OkHttp' })(entry({}))).toBe(true);
    expect(requestMatcher({ ...range, path: 'email' })(entry({}))).toBe(false);
    expect(requestMatcher({ ...range, path: 'email', showQuery: true })(entry({}))).toBe(true);
  });

  it('matches service and minimum response time, leaving out requests without a target time', () => {
    expect(requestMatcher({ ...range, service: 'game' })(entry({}))).toBe(true);
    expect(requestMatcher({ ...range, minResponseMs: 100 })(entry({ responseMs: 150 }))).toBe(true);
    expect(requestMatcher({ ...range, minResponseMs: 100 })(entry({ responseMs: null }))).toBe(false);
  });

  it('shows paths without their query string by default', () => {
    expect(shown(entry({}), false).path).toBe('/v1/players');
    expect(shown(entry({}), true).path).toBe('/v1/players?email=a@example.com');
  });
});

describe('RequestStatsCollector', () => {
  it('adds up requests, the 5xx rate, percentiles and the busiest paths and hosts', () => {
    const stats = new RequestStatsCollector(false);
    for (let index = 1; index <= 100; index += 1) {
      stats.add(entry({ responseMs: index, path: index % 2 ? '/a?x=1' : '/b' }));
    }
    stats.add(entry({ elbStatus: 502, targetStatus: 502, responseMs: 1000 }));
    stats.add(entry({ host: 'unknown.example.com', elbStatus: 404, targetStatus: null, service: null, responseMs: null }));
    const result = stats.result();
    expect(result.requests).toBe(102);
    expect(result.errorRate).toBeCloseTo(1 / 102);
    expect(result.noTarget).toBe(1);
    expect(result.p50Ms).toBeGreaterThanOrEqual(50);
    expect(result.p50Ms).toBeLessThanOrEqual(52);
    expect(result.p99Ms).toBeGreaterThanOrEqual(99);
    expect(result.topPaths[0]).toEqual({ key: '/a', count: 50 });
    expect(result.topHosts).toEqual([
      { key: 'api.example.com', count: 101 },
      { key: 'unknown.example.com', count: 1 },
    ]);
  });

  it('has no percentiles without requests', () => {
    expect(new RequestStatsCollector(false).result()).toMatchObject({ requests: 0, errorRate: 0, p50Ms: null });
  });
});
