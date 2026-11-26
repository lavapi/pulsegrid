import { type Kysely, sql } from 'kysely';

const TABLES = ['notifications_sent', 'notification_settings', 'slack_apps'];

/** Personal Slack notifications are gone: the Slack app, each person's settings and the sent log. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of TABLES) {
    await sql`drop table if exists ${sql.table(table)}`.execute(db);
  }
};

export const down = (): Promise<void> =>
  Promise.reject(new Error('Removed Slack notifications cannot be brought back; their data was deleted.'));
