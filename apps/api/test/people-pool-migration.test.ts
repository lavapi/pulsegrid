import { type Kysely, sql } from 'kysely';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/connection';
import { migratorFor } from '../src/database/migrate';
import { withTenantContext } from '../src/database/tenant-context';
import { addDefaultRoles } from '../src/team/default-roles';
import { ownerUrl } from './support/test-app';

const DATABASE = 'devdash_pool_migration_test';
const PLAIN_OWNER = 'devdash_plain_owner';
const PLAIN_PASSWORD = 'plain_owner_local';
const plainUrl = `postgres://${PLAIN_OWNER}:${PLAIN_PASSWORD}@localhost:5432/${DATABASE}`;

const prepare = async (): Promise<void> => {
  const client = new Client({ connectionString: ownerUrl('devdash') });
  await client.connect();
  await client.query(`drop database if exists ${DATABASE} with (force)`);
  await client.query(`
    do $$ begin
      if not exists (select from pg_roles where rolname = '${PLAIN_OWNER}') then
        create role ${PLAIN_OWNER} login createrole nosuperuser nobypassrls password '${PLAIN_PASSWORD}';
      end if;
    end $$
  `);
  await client.query(`create database ${DATABASE} owner ${PLAIN_OWNER}`);
  await client.end();
};

describe('moving people into one pool, as a database role without superuser rights', () => {
  let plain: Kysely<any>;
  let admin: Kysely<any>;
  const ids: Record<string, string> = {};

  const addPerson = (tenantId: string, email: string, role: string, isOwner: boolean) =>
    withTenantContext(plain, tenantId, async (trx) => {
      const { rows: accounts } = await sql<{ id: string }>`
        insert into accounts (tenant_id, email) values (${tenantId}, ${email}) returning id
      `.execute(trx);
      const { rows: users } = await sql<{ id: string }>`
        insert into users (tenant_id, account_id, role_id, is_owner, email, display_name, last_login_at)
        select ${tenantId}, ${accounts[0]!.id}, id, ${isOwner}, ${email}, ${`Name of ${email}`}, now()
        from roles where name = ${role}
        returning id
      `.execute(trx);
      ids[email] = accounts[0]!.id;
      return users[0]!.id;
    });

  beforeAll(async () => {
    await prepare();
    plain = createDatabase(plainUrl);
    admin = createDatabase(ownerUrl(DATABASE));
    await migratorFor(plain).migrateTo('0025_environment_domain_updates');
    for (const slug of ['first', 'second']) {
      const { rows } = await sql<{ id: string }>`insert into tenants (slug, name) values (${slug}, ${slug}) returning id`.execute(plain);
      ids[slug] = rows[0]!.id;
      await withTenantContext(plain, ids[slug]!, (trx) => addDefaultRoles(trx, ids[slug]!));
    }
    await addPerson(ids.first!, 'owner@example.test', 'Admin', true);
    const viewer = await addPerson(ids.first!, 'viewer@example.test', 'Viewer', false);
    await addPerson(ids.second!, 'other-owner@example.test', 'Admin', true);
    await withTenantContext(plain, ids.first!, (trx) =>
      sql`
        insert into sessions (tenant_id, user_id, token_hash, expires_at)
        values (${ids.first}, ${viewer}, 'hash', now() + interval '1 hour')
      `.execute(trx),
    );
    await withTenantContext(plain, ids.second!, (trx) =>
      sql`
        insert into environments (tenant_id, name)
        values (${ids.second}, 'EU staging'), (${ids.second}, 'Production'), (${ids.second}, 'Customers')
      `.execute(trx),
    );
    await migratorFor(plain).migrateToLatest();
  });
  afterAll(async () => {
    await plain.destroy();
    await admin.destroy();
  });

  it('keeps everyone with a name, and makes the first workspace owner the only super admin', async () => {
    const { rows } = await sql<{ email: string; display_name: string; is_super_admin: boolean; last_tenant_id: string }>`
      select email, display_name, is_super_admin, last_tenant_id from accounts order by email
    `.execute(admin);
    expect(rows).toEqual([
      { email: 'other-owner@example.test', display_name: 'Name of other-owner@example.test', is_super_admin: false, last_tenant_id: ids.second },
      { email: 'owner@example.test', display_name: 'Name of owner@example.test', is_super_admin: true, last_tenant_id: ids.first },
      { email: 'viewer@example.test', display_name: 'Name of viewer@example.test', is_super_admin: false, last_tenant_id: ids.first },
    ]);
  });

  it('keeps memberships and roles, and seats the super admin in every project', async () => {
    const { rows } = await sql<{ email: string; tenant: string; role: string }>`
      select users.email, tenants.slug as tenant, roles.name as role
      from users join tenants on tenants.id = users.tenant_id join roles on roles.id = users.role_id
      order by tenants.slug, users.email
    `.execute(admin);
    expect(rows).toEqual([
      { email: 'owner@example.test', tenant: 'first', role: 'Admin' },
      { email: 'viewer@example.test', tenant: 'first', role: 'Viewer' },
      { email: 'other-owner@example.test', tenant: 'second', role: 'Admin' },
      { email: 'owner@example.test', tenant: 'second', role: 'Admin' },
    ]);
  });

  it('moves open sessions to the person and keeps their project', async () => {
    const { rows } = await sql<{ account_id: string; tenant_id: string }>`select account_id, tenant_id from sessions`.execute(admin);
    expect(rows).toEqual([{ account_id: ids['viewer@example.test'], tenant_id: ids.first }]);
  });

  it('turns the per-project filter back on for people and roles', async () => {
    const { rows } = await sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relname in ('users', 'roles', 'sessions') order by relname
    `.execute(admin);
    expect(rows).toEqual([
      { relname: 'roles', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'sessions', relrowsecurity: false, relforcerowsecurity: false },
      { relname: 'users', relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it('marks environments as production from their names, without superuser rights', async () => {
    const { rows } = await sql<{ name: string; is_production: boolean }>`
      select name, is_production from environments order by name
    `.execute(admin);
    expect(rows).toEqual([
      { name: 'Customers', is_production: true },
      { name: 'EU staging', is_production: false },
      { name: 'Production', is_production: true },
    ]);
  });

  it('refuses to delete a project other than the current one', async () => {
    await withTenantContext(plain, ids.first!, (trx) => sql`select delete_project(${ids.second})`.execute(trx));
    const { rows } = await sql<{ count: string }>`select count(*) from tenants where id = ${ids.second}`.execute(admin);
    expect(Number(rows[0]!.count)).toBe(1);
  });

  it('deletes a whole project through its function, without superuser rights', async () => {
    await withTenantContext(plain, ids.second!, (trx) => sql`select delete_project(${ids.second})`.execute(trx));
    const { rows } = await sql<{ count: string }>`
      select (select count(*) from users where tenant_id = ${ids.second})
        + (select count(*) from roles where tenant_id = ${ids.second})
        + (select count(*) from tenants where id = ${ids.second}) as count
    `.execute(admin);
    expect(Number(rows[0]!.count)).toBe(0);
    const { rows: owner } = await sql<{ last_tenant_id: string | null }>`
      select last_tenant_id from accounts where email = 'other-owner@example.test'
    `.execute(admin);
    expect(owner[0]!.last_tenant_id).toBeNull();
  });
});
