import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table pipeline_apps (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      name text not null,
      repository text not null,
      created_at timestamptz not null default now(),
      unique (tenant_id, repository)
    )
  `.execute(db);
  await sql`create unique index pipeline_apps_name_key on pipeline_apps (tenant_id, lower(name))`.execute(db);
  await enableTenantIsolation(db, 'pipeline_apps');
  await sql`grant select, insert, update, delete on pipeline_apps to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table pipeline_apps`.execute(db);
};
