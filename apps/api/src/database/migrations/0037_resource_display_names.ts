import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

/** Display names given in PulseGrid, keyed by the resource's cloud id so they survive syncs and recreation. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table resource_display_names (
      tenant_id uuid not null references tenants (id) on delete cascade,
      cloud_account_id uuid not null references cloud_accounts (id) on delete cascade,
      native_id text not null,
      display_name text not null check (length(display_name) between 1 and 80),
      updated_by_email text,
      updated_at timestamptz not null default now(),
      primary key (cloud_account_id, native_id)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'resource_display_names');
  await sql`grant select, insert, update, delete on resource_display_names to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table resource_display_names`.execute(db);
};
