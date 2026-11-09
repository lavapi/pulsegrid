import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table aws_accounts rename to cloud_accounts`.execute(db);
  await sql`alter table cloud_accounts add column provider text not null default 'aws'`.execute(db);
  await sql`alter table cloud_accounts alter column provider drop default`.execute(db);
  await sql`alter table cloud_accounts rename column encrypted_key to encrypted_credentials`.execute(db);
  await sql`alter table cloud_accounts rename column key_hint to credential_hint`.execute(db);
  await sql`alter table cloud_accounts rename column key_can_write to can_write`.execute(db);
  await sql`alter table cloud_accounts drop constraint aws_accounts_account_id_check`.execute(db);
  await sql`alter table cloud_accounts drop constraint aws_accounts_tenant_id_account_id_key`.execute(db);
  await sql`alter table cloud_accounts add unique (tenant_id, provider, account_id)`.execute(db);
  await sql`alter table resources rename column aws_account_id to cloud_account_id`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table resources rename column cloud_account_id to aws_account_id`.execute(db);
  await sql`alter table cloud_accounts drop constraint cloud_accounts_tenant_id_provider_account_id_key`.execute(db);
  await sql`alter table cloud_accounts add unique (tenant_id, account_id)`.execute(db);
  await sql`alter table cloud_accounts rename column can_write to key_can_write`.execute(db);
  await sql`alter table cloud_accounts rename column credential_hint to key_hint`.execute(db);
  await sql`alter table cloud_accounts rename column encrypted_credentials to encrypted_key`.execute(db);
  await sql`alter table cloud_accounts drop column provider`.execute(db);
  await sql`alter table cloud_accounts rename to aws_accounts`.execute(db);
};
