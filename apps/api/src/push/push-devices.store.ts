import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database, PushEnvironment } from '../database/schema';

export interface PushDevice {
  id: string;
  apnsToken: string;
  environment: PushEnvironment;
}

/** Phones that take notifications, one per signed-in app. Signing the app out forgets its phone. */
@Injectable()
export class PushDevicesStore {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  /** Ties the phone's token to this sign-in; a token moving to a new sign-in leaves the old one. */
  async register(accountId: string, sessionId: string, apnsToken: string, environment: PushEnvironment): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('push_devices').where('apns_token', '=', apnsToken).where('session_id', '!=', sessionId).execute();
      await trx
        .insertInto('push_devices')
        .values({ account_id: accountId, session_id: sessionId, apns_token: apnsToken, environment })
        .onConflict((conflict) =>
          conflict.column('session_id').doUpdateSet({ apns_token: apnsToken, environment, updated_at: new Date() }),
        )
        .execute();
    });
  }

  async unregister(sessionId: string): Promise<void> {
    await this.db.deleteFrom('push_devices').where('session_id', '=', sessionId).execute();
  }

  async forAccounts(accountIds: readonly string[]): Promise<PushDevice[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('push_devices')
      .innerJoin('sessions', 'sessions.id', 'push_devices.session_id')
      .select(['push_devices.id', 'push_devices.apns_token', 'push_devices.environment'])
      .where('push_devices.account_id', 'in', accountIds)
      .where('sessions.expires_at', '>', new Date())
      .execute();
    return rows.map((row) => ({ id: row.id, apnsToken: row.apns_token, environment: row.environment }));
  }

  async forget(id: string): Promise<void> {
    await this.db.deleteFrom('push_devices').where('id', '=', id).execute();
  }
}
