import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table experiment_reports (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      cloud_account_id uuid not null references cloud_accounts (id) on delete cascade,
      region text not null,
      experiment_id text not null,
      template_id text not null,
      label text not null,
      account_name text not null,
      environment_name text,
      is_production boolean not null,
      started_by_email text,
      state text not null,
      reason text,
      started_at timestamptz,
      ended_at timestamptz,
      details jsonb not null,
      created_at timestamptz not null default now(),
      unique (cloud_account_id, region, experiment_id)
    )
  `.execute(db);
  await sql`create index experiment_reports_latest on experiment_reports (tenant_id, started_at desc)`.execute(db);
  await enableTenantIsolation(db, 'experiment_reports');
  await sql`grant select, insert, delete on experiment_reports to devdash_app`.execute(db);
  await sql`grant delete on experiment_runs to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`revoke delete on experiment_runs from devdash_app`.execute(db);
  await sql`drop table experiment_reports`.execute(db);
};
