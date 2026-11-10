import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table experiment_groups (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      cloud_account_id uuid not null references cloud_accounts (id) on delete cascade,
      name text not null,
      templates jsonb not null,
      created_at timestamptz not null default now(),
      unique (cloud_account_id, name)
    )
  `.execute(db);
  await sql`
    create table experiment_runs (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      cloud_account_id uuid not null references cloud_accounts (id) on delete cascade,
      label text not null,
      items jsonb not null,
      started_by_email text,
      started_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create index experiment_runs_latest on experiment_runs (cloud_account_id, started_at desc)`.execute(db);
  await enableTenantIsolation(db, 'experiment_groups');
  await enableTenantIsolation(db, 'experiment_runs');
  await sql`grant select, insert, update, delete on experiment_groups to devdash_app`.execute(db);
  await sql`grant select, insert on experiment_runs to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table experiment_runs`.execute(db);
  await sql`drop table experiment_groups`.execute(db);
};
