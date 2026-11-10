import type { ThrottlerStorage } from '@nestjs/throttler';
import type { RedisClient } from '../../redis/redis-connection';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local blocked = redis.call('PTTL', KEYS[2])
if blocked <= 0 and hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return { hits, redis.call('PTTL', KEYS[1]), blocked }
`;

const seconds = (milliseconds: number): number => Math.max(0, Math.ceil(milliseconds / 1000));

/** Counts requests in Redis, so every API instance shares one limit. */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisClient) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const base = `throttle:${throttlerName}:${key}`;
    const [hits, expiresIn, blockedFor] = (await this.redis.eval(
      INCREMENT,
      2,
      base,
      `${base}:blocked`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number];
    return {
      totalHits: hits,
      timeToExpire: seconds(expiresIn),
      isBlocked: blockedFor > 0,
      timeToBlockExpire: seconds(blockedFor),
    };
  }
}
