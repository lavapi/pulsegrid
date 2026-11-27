import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

/**
 * Each person's choice of push notifications, and the pipeline runs started from PulseGrid that are watched so
 * the person who started one hears if it fails.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table notification_settings (
      account_id uuid primary key references accounts (id) on delete cascade,
      settings jsonb not null default '{}',
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`grant select, insert, update on notification_settings to devdash_app`.execute(db);

  await sql`
    create table watched_pipeline_runs (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      user_id uuid not null references users (id) on delete cascade,
      app_id uuid not null references pipeline_apps (id) on delete cascade,
      workflow_id text not null,
      pipeline_name text not null,
      branch text not null,
      run_id text,
      started_at timestamptz not null default now(),
      expires_at timestamptz not null
    )
  `.execute(db);
  await sql`create index watched_pipeline_runs_expiry on watched_pipeline_runs (expires_at)`.execute(db);
  await sql`grant select, insert, update, delete on watched_pipeline_runs to devdash_app`.execute(db);
  await enableTenantIsolation(db, 'watched_pipeline_runs');
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table watched_pipeline_runs`.execute(db);
  await sql`drop table notification_settings`.execute(db);
};
