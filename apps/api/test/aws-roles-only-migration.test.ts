import { type Kysely, sql } from 'kysely';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/connection';
import { migratorFor } from '../src/database/migrate';
import { ownerUrl } from './support/test-app';

const DATABASE = 'devdash_aws_roles_only_migration_test';

const recreate = async (): Promise<void> => {
  const client = new Client({ connectionString: ownerUrl('devdash') });
  await client.connect();
  await client.query(`drop database if exists ${DATABASE} with (force)`);
  await client.query(`create database ${DATABASE}`);
  await client.end();
};

describe('AWS accounts connect only through roles', () => {
  let db: Kysely<any>;

  const accounts = async () => {
    await sql`alter table cloud_accounts no force row level security`.execute(db);
    const { rows } = await sql<{
      account_id: string;
      credential_kind: string;
      has_credentials: boolean;
      credential_hint: string | null;
    }>`
      select account_id, credential_kind, encrypted_credentials is not null as has_credentials, credential_hint
      from cloud_accounts order by account_id
    `.execute(db);
    await sql`alter table cloud_accounts force row level security`.execute(db);
    return rows;
  };

  beforeAll(async () => {
    await recreate();
    db = createDatabase(ownerUrl(DATABASE));
    await migratorFor(db).migrateTo('0041_credential_kind');
    const { rows } = await sql<{ id: string }>`insert into tenants (slug, name) values ('acme', 'Acme') returning id`.execute(db);
    const tenantId = rows[0]!.id;
    await sql`select set_config('app.tenant_id', ${tenantId}, false)`.execute(db);
    const add = (accountId: string, provider: string, kind: string, hint: string) => sql`
      insert into cloud_accounts (tenant_id, provider, account_id, name, regions, encrypted_credentials, credential_hint, credential_kind)
      values (${tenantId}, ${provider}, ${accountId}, ${accountId}, '{eu-central-1}', 'sealed', ${hint}, ${kind})
    `.execute(db);
    await add('111111111111', 'aws', 'key', 'AKIA…MNOP');
    await add('222222222222', 'aws', 'role', 'Role PulseGridAccess');
    await add('other-project', 'othercloud', 'key', '…42');
    await sql`select set_config('app.tenant_id', '', false)`.execute(db);
    await migratorFor(db).migrateTo('0042_aws_roles_only');
  });
  afterAll(() => db.destroy());

  it('clears an AWS key still stored, so the account asks to be connected again', async () => {
    expect(await accounts()).toEqual([
      { account_id: '111111111111', credential_kind: 'role', has_credentials: false, credential_hint: null },
      { account_id: '222222222222', credential_kind: 'role', has_credentials: true, credential_hint: 'Role PulseGridAccess' },
      { account_id: 'other-project', credential_kind: 'key', has_credentials: true, credential_hint: '…42' },
    ]);
  });

  it('drops the key age', async () => {
    const { rows } = await sql<{ found: boolean }>`
      select exists (
        select 1 from information_schema.columns
        where table_name = 'cloud_accounts' and column_name = 'credentials_updated_at'
      ) as found
    `.execute(db);
    expect(rows[0]?.found).toBe(false);
  });
});
