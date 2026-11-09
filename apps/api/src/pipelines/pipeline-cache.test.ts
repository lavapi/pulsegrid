import type Redis from 'ioredis';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PipelineCache } from './pipeline-cache';

const fakeRedis = () => {
  const values = new Map<string, string>();
  const redis = {
    values,
    get: async (key: string) => values.get(key) ?? null,
    mget: async (...keys: string[]) => keys.map((key) => values.get(key) ?? null),
    del: async (...keys: string[]) => keys.forEach((key) => values.delete(key)),
    set: async (key: string, value: string, ...options: unknown[]) => {
      if (options.includes('NX') && values.has(key)) {
        return null;
      }
      values.set(key, value);
      return 'OK';
    },
    multi: () => {
      const chain = {
        set: (key: string, value: string) => {
          values.set(key, value);
          return chain;
        },
        exec: async () => [],
      };
      return chain;
    },
  };
  return redis;
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('PipelineCache', () => {
  let redis: ReturnType<typeof fakeRedis>;
  let cache: PipelineCache;
  const load = vi.fn<() => Promise<string>>();

  beforeEach(() => {
    redis = fakeRedis();
    cache = new PipelineCache(redis as unknown as Redis);
    load.mockReset();
  });

  it('waits for the first load, then reuses it', async () => {
    load.mockResolvedValue('first');
    expect(await cache.rememberStale('k', 10, load)).toBe('first');
    expect(await cache.rememberStale('k', 10, load)).toBe('first');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('answers with old data at once and refreshes in the background', async () => {
    load.mockResolvedValue('first');
    await cache.rememberStale('k', 10, load);
    redis.values.delete('pipelines:k');
    load.mockResolvedValue('second');

    expect(await cache.rememberStale('k', 10, load)).toBe('first');
    await settle();
    expect(await cache.rememberStale('k', 10, load)).toBe('second');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('refreshes once when many pages ask together', async () => {
    load.mockResolvedValue('first');
    await cache.rememberStale('k', 10, load);
    redis.values.delete('pipelines:k');
    let finish: (value: string) => void = () => undefined;
    load.mockReturnValue(new Promise((resolve) => (finish = resolve)));

    await Promise.all([cache.rememberStale('k', 10, load), cache.rememberStale('k', 10, load)]);
    await settle();
    finish('second');
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps old data when a background refresh fails', async () => {
    load.mockResolvedValue('first');
    await cache.rememberStale('k', 10, load);
    redis.values.delete('pipelines:k');
    load.mockRejectedValue(new Error('down'));

    expect(await cache.rememberStale('k', 10, load)).toBe('first');
    await settle();
    expect(await cache.rememberStale('k', 10, load)).toBe('first');
  });

  it('forgets old data too, so a change shows straight away', async () => {
    load.mockResolvedValue('first');
    await cache.rememberStale('k', 10, load);
    await cache.forget('k');
    load.mockResolvedValue('second');
    expect(await cache.rememberStale('k', 10, load)).toBe('second');
  });
});
