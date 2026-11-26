import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

/** Requests for database access from people who can't grant it, waiting for an approver. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table database_access_requests (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      requested_by_user_id uuid not null references users (id) on delete cascade,
      requested_by_email text not null,
      requested_by_name text not null,
      user_name text not null check (length(user_name) between 1 and 128),
      hours integer not null check (hours between 1 and 8),
      reason text not null check (length(reason) between 1 and 500),
      status text not null check (status in ('pending', 'approved', 'declined', 'cancelled', 'expired')),
      decided_by_email text,
      decided_at timestamptz,
      decline_reason text check (length(decline_reason) <= 500),
      grant_id uuid references database_access_grants (id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`
    create unique index database_access_requests_one_pending
    on database_access_requests (tenant_id, requested_by_user_id)
    where status = 'pending'
  `.execute(db);
  await sql`create index database_access_requests_recent on database_access_requests (tenant_id, created_at desc)`.execute(
    db,
  );
  await enableTenantIsolation(db, 'database_access_requests');
  await sql`grant select, insert, update on database_access_requests to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table database_access_requests`.execute(db);
};
