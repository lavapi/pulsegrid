import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table action_runs (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      resource_id uuid not null references resources (id) on delete cascade,
      permission text not null,
      status text not null default 'running'
        check (status in ('running', 'succeeded', 'failed', 'timed_out', 'unconfirmed')),
      summary text not null,
      tracking_id text,
      started_by_user_id uuid references users (id) on delete set null,
      started_by_email text not null,
      started_at timestamptz not null default now(),
      expires_at timestamptz not null,
      finished_at timestamptz
    )
  `.execute(db);
  await sql`
    create unique index action_runs_active_key on action_runs (resource_id) where status = 'running'
  `.execute(db);
  await sql`create index action_runs_latest on action_runs (resource_id, started_at desc)`.execute(db);
  await enableTenantIsolation(db, 'action_runs');
  await sql`grant select, insert, update on action_runs to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table action_runs`.execute(db);
};
