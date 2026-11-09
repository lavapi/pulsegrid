import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table environments (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      name text not null,
      sort_order integer not null default 100,
      created_at timestamptz not null default now(),
      unique (tenant_id, name)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'environments');
  await sql`grant select, insert, update, delete on environments to devdash_app`.execute(db);

  await sql`
    alter table aws_accounts
      add column environment_id uuid references environments (id) on delete set null,
      add column environment_reviewed boolean not null default false
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table aws_accounts drop column environment_id, drop column environment_reviewed
  `.execute(db);
  await sql`drop table environments`.execute(db);
};
