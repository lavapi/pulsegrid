import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table release_targets (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      app_id uuid not null references pipeline_apps (id) on delete cascade,
      workflow_id text not null,
      cloud_account_id uuid not null references cloud_accounts (id) on delete cascade,
      native_id text not null,
      service_name text not null,
      created_at timestamptz not null default now(),
      unique (app_id, workflow_id, cloud_account_id, native_id)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'release_targets');
  await sql`grant select, insert, delete on release_targets to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table release_targets`.execute(db);
};
