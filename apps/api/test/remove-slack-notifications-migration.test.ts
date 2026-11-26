import { type Kysely, sql } from 'kysely';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/connection';
import { migratorFor } from '../src/database/migrate';
import { ownerUrl } from './support/test-app';

const DATABASE = 'devdash_remove_slack_notifications_migration_test';
const TABLES = ['slack_apps', 'notification_settings', 'notifications_sent'];

const recreate = async (): Promise<void> => {
  const client = new Client({ connectionString: ownerUrl('devdash') });
  await client.connect();
  await client.query(`drop database if exists ${DATABASE} with (force)`);
  await client.query(`create database ${DATABASE}`);
  await client.end();
};

describe('removing Slack notifications', () => {
  let db: Kysely<any>;

  const tableExists = async (name: string) =>
    (await sql<{ found: boolean }>`select to_regclass(${name}) is not null as found`.execute(db)).rows[0]?.found;

  beforeAll(async () => {
    await recreate();
    db = createDatabase(ownerUrl(DATABASE));
    await migratorFor(db).migrateTo('0043_slack_notifications');
    const { rows } = await sql<{ id: string }>`insert into tenants (slug, name) values ('acme', 'Acme') returning id`.execute(db);
    const tenantId = rows[0]!.id;
    await sql`select set_config('app.tenant_id', ${tenantId}, false)`.execute(db);
    await sql`insert into slack_apps (tenant_id, encrypted_token, workspace) values (${tenantId}, 'sealed', 'Acme')`.execute(db);
    await sql`insert into notifications_sent (tenant_id, key) values (${tenantId}, 'pr:acme/api#1:sha:ready')`.execute(db);
    await sql`select set_config('app.tenant_id', '', false)`.execute(db);
    for (const table of TABLES) {
      expect(await tableExists(table)).toBe(true);
    }
    await migratorFor(db).migrateTo('0044_remove_slack_notifications');
  });
  afterAll(() => db.destroy());

  it('drops the Slack app, notification settings and sent log tables with their data', async () => {
    for (const table of TABLES) {
      expect(await tableExists(table)).toBe(false);
    }
  });

  it('leaves the rest of the project in place', async () => {
    const { rows } = await sql<{ slug: string }>`select slug from tenants`.execute(db);
    expect(rows.map(({ slug }) => slug)).toEqual(['acme']);
  });
});
