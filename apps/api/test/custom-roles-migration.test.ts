import { type Kysely, sql } from 'kysely';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/connection';
import { migratorFor } from '../src/database/migrate';
import { ownerUrl } from './support/test-app';

const DATABASE = 'devdash_roles_migration_test';

const recreate = async (): Promise<void> => {
  const client = new Client({ connectionString: ownerUrl('devdash') });
  await client.connect();
  await client.query(`drop database if exists ${DATABASE} with (force)`);
  await client.query(`create database ${DATABASE}`);
  await client.end();
};

describe('moving people to roles', () => {
  let db: Kysely<any>;

  const addUser = async (tenantId: string, email: string, role: string, isOwner = false) => {
    const { rows } = await sql<{ id: string }>`
      insert into users (tenant_id, role, is_owner, email, display_name, last_login_at)
      values (${tenantId}, ${role}, ${isOwner}, ${email}, ${email}, now())
      returning id
    `.execute(db);
    return rows[0]!.id;
  };
  const tick = (tenantId: string, userId: string, permission: string) =>
    sql`
      insert into user_permissions (tenant_id, user_id, permission)
      values (${tenantId}, ${userId}, ${permission})
    `.execute(db);
  const permissionsOf = async (email: string) => {
    const { rows } = await sql<{ name: string; permissions: string[] }>`
      select roles.name, array_remove(array_agg(role_permissions.permission), null) as permissions
      from users
      join roles on roles.id = users.role_id
      left join role_permissions on role_permissions.role_id = roles.id
      where users.email = ${email}
      group by roles.name
    `.execute(db);
    return rows[0]!;
  };

  beforeAll(async () => {
    await recreate();
    db = createDatabase(ownerUrl(DATABASE));
    await migratorFor(db).migrateTo('0020_tag_filters');
    const { rows } = await sql<{ id: string }>`
      insert into tenants (slug, name) values ('acme', 'Acme') returning id
    `.execute(db);
    const tenantId = rows[0]!.id;
    const { rows: others } = await sql<{ id: string }>`
      insert into tenants (slug, name) values ('globex', 'Globex') returning id
    `.execute(db);
    await addUser(others[0]!.id, 'elsewhere@example.test', 'viewer');
    await addUser(tenantId, 'owner@example.test', 'admin', true);
    await addUser(tenantId, 'viewer@example.test', 'viewer');
    await addUser(tenantId, 'plain@example.test', 'developer');
    for (const email of ['one@example.test', 'two@example.test']) {
      const id = await addUser(tenantId, email, 'developer');
      await tick(tenantId, id, 'secret.write');
    }
    const other = await addUser(tenantId, 'three@example.test', 'developer');
    await tick(tenantId, other, 'logs.read');
    await migratorFor(db).migrateTo('0025_environment_domain_updates');
  });
  afterAll(() => db.destroy());

  it('gives the starting roles what those people could already do', async () => {
    const owner = await permissionsOf('owner@example.test');
    expect(owner.name).toBe('Admin');
    expect(owner.permissions).toEqual(expect.arrayContaining(['team.view', 'integrations.manage']));
    expect(owner.permissions).not.toContain('secret.write');
    expect(await permissionsOf('viewer@example.test')).toEqual({ name: 'Viewer', permissions: [] });
    expect((await permissionsOf('plain@example.test')).name).toBe('Developer');
  });

  it('keeps every workspace on its own roles', async () => {
    const { rows } = await sql<{ mismatched: string }>`
      select count(*) as mismatched from users
      join roles on roles.id = users.role_id
      where roles.tenant_id != users.tenant_id
    `.execute(db);
    expect(Number(rows[0]!.mismatched)).toBe(0);
    expect((await permissionsOf('elsewhere@example.test')).name).toBe('Viewer');
  });

  it('keeps per-person ticks, sharing a role when they match', async () => {
    const [one, two, three] = [
      await permissionsOf('one@example.test'),
      await permissionsOf('two@example.test'),
      await permissionsOf('three@example.test'),
    ];
    expect(one.name).toMatch(/^Developer custom/);
    expect(two.name).toBe(one.name);
    expect(one.permissions).toEqual(expect.arrayContaining(['secret.write', 'pipeline.run']));
    expect(three.name).not.toBe(one.name);
    expect(three.permissions).toContain('logs.read');
  });

  it('lets Admins see costs, and nobody else', async () => {
    const seesCosts = async (email: string) =>
      (await permissionsOf(email)).permissions.includes('costs.view');
    expect(await seesCosts('elsewhere@example.test')).toBe(false);
    expect(await seesCosts('owner@example.test')).toBe(true);
  });
});
