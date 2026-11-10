import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { RedisThrottlerStorage } from './redis-throttler-storage';

const redis = new Redis('redis://localhost:6379/1', { keyPrefix: `throttler-test:${randomUUID()}:` });
const storage = new RedisThrottlerStorage(redis);

describe('RedisThrottlerStorage', () => {
  afterAll(() => redis.quit());

  it('counts hits across calls and blocks over the limit', async () => {
    const first = await storage.increment('ip', 60_000, 2, 30_000, 'default');
    await storage.increment('ip', 60_000, 2, 30_000, 'default');
    const third = await storage.increment('ip', 60_000, 2, 30_000, 'default');
    expect(first).toMatchObject({ totalHits: 1, isBlocked: false, timeToExpire: 60 });
    expect(third).toMatchObject({ totalHits: 3, isBlocked: true, timeToBlockExpire: 30 });
  });

  it('keeps separate counts per key and throttler', async () => {
    await storage.increment('shared', 60_000, 1, 1_000, 'default');
    expect((await storage.increment('other', 60_000, 1, 1_000, 'default')).totalHits).toBe(1);
    expect((await storage.increment('shared', 60_000, 1, 1_000, 'strict')).totalHits).toBe(1);
  });
});
