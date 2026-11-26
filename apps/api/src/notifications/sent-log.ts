import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../database/tenant-context';

const KEEP_DAYS = 30;

/** What has been sent, by a key naming the event, so each message goes once however often the worker looks. */
@Injectable()
export class SentLog {
  async unsent(trx: TenantTransaction, keys: readonly string[]): Promise<Set<string>> {
    if (keys.length === 0) {
      return new Set();
    }
    const sent = await trx.selectFrom('notifications_sent').select('key').where('key', 'in', keys).execute();
    const already = new Set(sent.map(({ key }) => key));
    return new Set(keys.filter((key) => !already.has(key)));
  }

  async markSent(trx: TenantTransaction, tenantId: string, key: string): Promise<void> {
    await trx
      .insertInto('notifications_sent')
      .values({ tenant_id: tenantId, key })
      .onConflict((conflict) => conflict.doNothing())
      .execute();
  }

  async forgetOld(trx: TenantTransaction): Promise<void> {
    await trx
      .deleteFrom('notifications_sent')
      .where('sent_at', '<', sql<Date>`now() - make_interval(days => ${KEEP_DAYS})`)
      .execute();
  }
}
