import { Inject, Injectable } from '@nestjs/common';
import {
  type NotificationSettings,
  notificationSettings,
  type NotificationTopic,
} from '@pulsegrid/shared';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';

/** Each person's push notification choices, kept per account so they apply in every project and on every phone. */
@Injectable()
export class NotificationSettingsStore {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async get(accountId: string): Promise<NotificationSettings> {
    const row = await this.db
      .selectFrom('notification_settings')
      .select('settings')
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return notificationSettings(row?.settings ?? {});
  }

  async update(accountId: string, changes: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const settings = { ...(await this.get(accountId)), ...changes };
    await this.db
      .insertInto('notification_settings')
      .values({ account_id: accountId, settings: JSON.stringify(settings) })
      .onConflict((conflict) =>
        conflict.column('account_id').doUpdateSet({ settings: JSON.stringify(settings), updated_at: new Date() }),
      )
      .execute();
    return settings;
  }

  /** The accounts among these that want notifications about the topic. */
  async allowing(accountIds: readonly string[], topic: NotificationTopic): Promise<string[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.db
      .selectFrom('notification_settings')
      .select(['account_id', 'settings'])
      .where('account_id', 'in', accountIds)
      .execute();
    const saved = new Map(rows.map((row) => [row.account_id, notificationSettings(row.settings)]));
    return accountIds.filter((id) => (saved.get(id) ?? notificationSettings({}))[topic]);
  }
}
