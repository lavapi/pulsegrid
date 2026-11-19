import { type Kysely, sql } from 'kysely';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/connection';
import { migratorFor } from '../src/database/migrate';
import { ownerUrl } from './support/test-app';

const DATABASE = 'devdash_remove_alerts_migration_test';

const recreate = async (): Promise<void> => {
  const client = new Client({ connectionString: ownerUrl('devdash') });
  await client.connect();
  await client.query(`drop database if exists ${DATABASE} with (force)`);
  await client.query(`create database ${DATABASE}`);
  await client.end();
};

describe('removing security alerts', () => {
  let db: Kysely<any>;

  const tableExists = async (name: string) =>
    (await sql<{ found: boolean }>`select to_regclass(${name}) is not null as found`.execute(db)).rows[0]?.found;

  beforeAll(async () => {
    await recreate();
    db = createDatabase(ownerUrl(DATABASE));
    await migratorFor(db).migrateTo('0039_security_alerts');
    const { rows } = await sql<{ id: string }>`insert into tenants (slug, name) values ('acme', 'Acme') returning id`.execute(db);
    const tenantId = rows[0]!.id;
    await sql`select set_config('app.tenant_id', ${tenantId}, false)`.execute(db);
    const role = await sql<{ id: string }>`insert into roles (tenant_id, name) values (${tenantId}, 'Admin') returning id`.execute(db);
    for (const permission of ['security.view', 'security.manage', 'logs.read']) {
      await sql`insert into role_permissions (tenant_id, role_id, permission) values (${tenantId}, ${role.rows[0]!.id}, ${permission})`.execute(db);
    }
    await sql`
      insert into security_alerts (tenant_id, alert_key, source, severity, title, account_id, occurred_at, aws_updated_at, raw_event)
      values (${tenantId}, 'finding-1', 'guardduty', 'HIGH', 'A finding', '860922939595', now(), now(), '{}')
    `.execute(db);
    await sql`select set_config('app.tenant_id', '', false)`.execute(db);
    await migratorFor(db).migrateTo('0040_remove_security_alerts');
  });
  afterAll(() => db.destroy());

  it('drops the alert and Slack tables with their data', async () => {
    for (const table of ['security_alerts', 'security_alert_status_changes', 'security_alert_messages', 'slack_integrations']) {
      expect(await tableExists(table)).toBe(false);
    }
  });

  it('takes the alert permissions off every role, keeping the rest', async () => {
    await sql`alter table role_permissions no force row level security`.execute(db);
    const { rows } = await sql<{ permission: string }>`select permission from role_permissions order by permission`.execute(db);
    await sql`alter table role_permissions force row level security`.execute(db);
    expect(rows.map(({ permission }) => permission)).toEqual(['logs.read']);
  });
});
