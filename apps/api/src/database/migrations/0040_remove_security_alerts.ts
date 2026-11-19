import { type Kysely, sql } from 'kysely';

const TABLES = ['security_alert_status_changes', 'security_alert_messages', 'security_alerts', 'slack_integrations'];
const PERMISSIONS = ['security.view', 'security.manage'];

/** Security alerts and Slack are gone: their tables, their data and the permissions to use them. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of TABLES) {
    await sql`drop table if exists ${sql.table(table)}`.execute(db);
  }
  await sql`alter table role_permissions no force row level security`.execute(db);
  await sql`delete from role_permissions where permission in (${sql.join(PERMISSIONS)})`.execute(db);
  await sql`alter table role_permissions force row level security`.execute(db);
};

export const down = (): Promise<void> =>
  Promise.reject(new Error('Removed security alerts cannot be brought back; their data was deleted.'));
