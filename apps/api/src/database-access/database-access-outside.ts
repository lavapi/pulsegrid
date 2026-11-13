import type { OutsideDatabaseAccess } from '@pulsegrid/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { RedisClient } from '../redis/redis-connection';
import { REDIS } from '../redis/redis.module';

const KEEP_SECONDS = 15 * 60;

export interface OutsideSnapshot {
  checkedAt: string;
  items: OutsideDatabaseAccess[];
}

/** The last reconcile's list of access granted outside PulseGrid, kept for 15 minutes. */
@Injectable()
export class DatabaseAccessOutside {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async save(tenantId: string, items: OutsideDatabaseAccess[]): Promise<void> {
    const snapshot: OutsideSnapshot = { checkedAt: new Date().toISOString(), items };
    await this.redis.set(this.key(tenantId), JSON.stringify(snapshot), 'EX', KEEP_SECONDS);
  }

  async read(tenantId: string): Promise<OutsideSnapshot | null> {
    const saved = await this.redis.get(this.key(tenantId));
    return saved ? (JSON.parse(saved) as OutsideSnapshot) : null;
  }

  private key(tenantId: string): string {
    return `database-access:outside:${tenantId}`;
  }
}
