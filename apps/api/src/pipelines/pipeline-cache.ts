import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedisClient } from '../redis/redis-connection';
import { REDIS } from '../redis/redis.module';

const PREFIX = 'pipelines:';
const STALE_PREFIX = 'pipelines-stale:';
const LOCK_PREFIX = 'pipelines-refresh:';
const STALE_SECONDS = 15 * 60;
const LOCK_SECONDS = 30;

type Ttl<T> = number | ((value: T) => number);

@Injectable()
export class PipelineCache {
  private readonly logger = new Logger(PipelineCache.name);

  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async remember<T>(key: string, ttlSeconds: Ttl<T>, load: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(`${PREFIX}${key}`);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
    return this.store(key, ttlSeconds, load);
  }

  async rememberStale<T>(key: string, ttlSeconds: Ttl<T>, load: () => Promise<T>): Promise<T> {
    const [cached, stale] = await this.redis.mget(`${PREFIX}${key}`, `${STALE_PREFIX}${key}`);
    if (cached) {
      return JSON.parse(cached) as T;
    }
    if (!stale) {
      return this.store(key, ttlSeconds, load);
    }
    void this.refresh(key, ttlSeconds, load);
    return JSON.parse(stale) as T;
  }

  async forget(key: string): Promise<void> {
    await this.redis.del(`${PREFIX}${key}`, `${STALE_PREFIX}${key}`);
  }

  private async store<T>(key: string, ttlSeconds: Ttl<T>, load: () => Promise<T>): Promise<T> {
    const value = await load();
    const ttl = typeof ttlSeconds === 'function' ? ttlSeconds(value) : ttlSeconds;
    const text = JSON.stringify(value);
    await this.redis
      .multi()
      .set(`${PREFIX}${key}`, text, 'EX', ttl)
      .set(`${STALE_PREFIX}${key}`, text, 'EX', Math.max(ttl, STALE_SECONDS))
      .exec();
    return value;
  }

  private async refresh<T>(key: string, ttlSeconds: Ttl<T>, load: () => Promise<T>): Promise<void> {
    const lock = `${LOCK_PREFIX}${key}`;
    try {
      if ((await this.redis.set(lock, '1', 'EX', LOCK_SECONDS, 'NX')) === 'OK') {
        await this.store(key, ttlSeconds, load);
        await this.redis.del(lock);
      }
    } catch (error) {
      this.logger.warn(`Background refresh failed: ${(error as Error).message}`);
    }
  }
}
