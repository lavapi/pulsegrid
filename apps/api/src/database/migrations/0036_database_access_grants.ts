import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table database_access_grants (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      granted_by_user_id uuid,
      granted_by_email text not null,
      user_name text not null check (length(user_name) between 1 and 128),
      user_id text,
      reason text not null check (length(reason) between 1 and 500),
      status text not null check (status in ('granting', 'active', 'revoked', 'expired', 'failed')),
      change text check (change in ('extending', 'revoking')),
      change_by_email text,
      execution_arn text,
      requested_expires_at timestamptz,
      failure text,
      starts_at timestamptz not null default now(),
      expires_at timestamptz not null,
      revoked_at timestamptz,
      revoked_by_email text,
      end_reason text check (end_reason in ('manual', 'expired')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`
    create unique index database_access_grants_one_open
    on database_access_grants (tenant_id, lower(user_name))
    where status in ('granting', 'active')
  `.execute(db);
  await sql`create index database_access_grants_history on database_access_grants (tenant_id, created_at desc)`.execute(
    db,
  );
  await enableTenantIsolation(db, 'database_access_grants');
  await sql`grant select, insert, update on database_access_grants to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table database_access_grants`.execute(db);
};
