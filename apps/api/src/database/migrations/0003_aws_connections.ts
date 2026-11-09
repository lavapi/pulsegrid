import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

const TABLES = ['aws_identity_settings', 'user_aws_connections', 'user_aws_accounts'] as const;

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table aws_accounts
      add column access_method text not null default 'role'
      check (access_method in ('role', 'identity_center'))
  `.execute(db);

  await sql`
    create table aws_identity_settings (
      tenant_id uuid primary key references tenants (id) on delete cascade,
      start_url text not null,
      sso_region text not null,
      regions text[] not null check (cardinality(regions) > 0),
      permission_set_name text not null,
      updated_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table user_aws_connections (
      user_id uuid primary key references users (id) on delete cascade,
      tenant_id uuid not null references tenants (id) on delete cascade,
      encrypted_tokens text not null,
      status text not null check (status in ('active', 'expired')),
      accounts_without_role jsonb not null default '[]',
      last_synced_at timestamptz,
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table user_aws_accounts (
      user_id uuid not null references users (id) on delete cascade,
      aws_account_id uuid not null references aws_accounts (id) on delete cascade,
      tenant_id uuid not null references tenants (id) on delete cascade,
      primary key (user_id, aws_account_id)
    )
  `.execute(db);

  for (const table of TABLES) {
    await enableTenantIsolation(db, table);
    await sql`grant select, insert, update, delete on ${sql.table(table)} to devdash_app`.execute(db);
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of [...TABLES].reverse()) {
    await sql`drop table ${sql.table(table)}`.execute(db);
  }
  await sql`alter table aws_accounts drop column access_method`.execute(db);
};
