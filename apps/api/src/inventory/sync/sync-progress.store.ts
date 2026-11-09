import { isSyncRunning, type SyncProgress } from '@pulsegrid/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedisClient } from '../../redis/redis-connection';
import { REDIS } from '../../redis/redis.module';
import { SyncTracker } from './sync-tracker';

const RUNNING_TTL_SECONDS = 15 * 60;
const FINISHED_TTL_SECONDS = 120;

export interface SyncTarget {
  tenantId: string;
  accountId: string;
}

const scopeOf = ({ tenantId, accountId }: SyncTarget): string => `${tenantId}:${accountId}`;
const progressKey = (target: SyncTarget): string => `sync-progress:${scopeOf(target)}`;
const watchKey = (target: SyncTarget): string => `sync-watch:${scopeOf(target)}`;

const initialProgress = (target: SyncTarget): SyncProgress => ({
  key: scopeOf(target),
  accountId: target.accountId,
  phase: 'queued',
  percent: 0,
  accounts: [],
  message: null,
  startedAt: new Date().toISOString(),
});

@Injectable()
export class SyncProgressStore {
  private readonly logger = new Logger(SyncProgressStore.name);

  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async watch(target: SyncTarget): Promise<void> {
    await this.redis.set(watchKey(target), '1', 'EX', RUNNING_TTL_SECONDS);
    const current = await this.read(target);
    if (!current || !isSyncRunning(current)) {
      await this.save(target, initialProgress(target));
    }
  }

  begin(target: SyncTarget): SyncTracker {
    return new SyncTracker(initialProgress(target), (progress) => this.publish(target, progress));
  }

  async watched(targets: readonly SyncTarget[]): Promise<SyncProgress[]> {
    const items = await Promise.all(
      targets.map(async (target) =>
        (await this.redis.exists(watchKey(target))) ? this.read(target) : null,
      ),
    );
    return items.flatMap((item) => item ?? []);
  }

  private async publish(target: SyncTarget, progress: SyncProgress): Promise<void> {
    try {
      await this.save(target, progress);
      const ttl = isSyncRunning(progress) ? RUNNING_TTL_SECONDS : FINISHED_TTL_SECONDS;
      await this.redis.expire(watchKey(target), ttl);
    } catch (error) {
      this.logger.warn(`Sync progress could not be saved: ${(error as Error).message}`);
    }
  }

  private async read(target: SyncTarget): Promise<SyncProgress | null> {
    const value = await this.redis.get(progressKey(target));
    return value ? (JSON.parse(value) as SyncProgress) : null;
  }

  private async save(target: SyncTarget, progress: SyncProgress): Promise<void> {
    const ttl = isSyncRunning(progress) ? RUNNING_TTL_SECONDS : FINISHED_TTL_SECONDS;
    await this.redis.set(progressKey(target), JSON.stringify(progress), 'EX', ttl);
  }
}
