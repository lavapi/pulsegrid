import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table aws_accounts (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      account_id text not null check (account_id ~ '^[0-9]{12}$'),
      name text not null,
      external_id text not null,
      regions text[] not null check (cardinality(regions) > 0),
      status text not null default 'pending' check (status in ('pending', 'connected', 'error')),
      last_error text,
      last_synced_at timestamptz,
      sync_issues jsonb not null default '[]',
      created_at timestamptz not null default now(),
      unique (tenant_id, account_id)
    )
  `.execute(db);

  await sql`
    create table resources (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      aws_account_id uuid not null references aws_accounts (id) on delete cascade,
      region text not null,
      type text not null,
      native_id text not null,
      name text not null,
      status text not null,
      health text not null check (health in ('healthy', 'degraded', 'stopped', 'unknown')),
      tags jsonb not null default '{}',
      details jsonb not null default '{}',
      last_seen_at timestamptz not null,
      unique (aws_account_id, type, region, native_id)
    )
  `.execute(db);
  await sql`create index resources_listing_idx on resources (tenant_id, name, id)`.execute(db);

  await enableTenantIsolation(db, 'aws_accounts');
  await enableTenantIsolation(db, 'resources');

  await sql`grant select, insert, update, delete on aws_accounts, resources to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table resources`.execute(db);
  await sql`drop table aws_accounts`.execute(db);
};
