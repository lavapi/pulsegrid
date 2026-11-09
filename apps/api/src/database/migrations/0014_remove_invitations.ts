import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table invitations`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table invitations (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      email text not null,
      role text not null check (role in ('viewer', 'developer', 'admin')),
      token_hash text not null unique,
      expires_at timestamptz not null,
      accepted_at timestamptz,
      created_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`
    create unique index invitations_pending_key on invitations (tenant_id, lower(email))
    where accepted_at is null
  `.execute(db);
  await enableTenantIsolation(db, 'invitations');
  await sql`grant select, insert, update, delete on invitations to devdash_app`.execute(db);
};
