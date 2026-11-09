import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table environment_domains (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      environment_id uuid not null references environments (id) on delete cascade,
      kind text not null check (kind in ('app', 'grafana')),
      label text,
      url text not null,
      created_at timestamptz not null default now(),
      unique (environment_id, url)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'environment_domains');
  await sql`grant select, insert, delete on environment_domains to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table environment_domains`.execute(db);
};
