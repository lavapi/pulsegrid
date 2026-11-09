import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table user_permissions (
      tenant_id uuid not null references tenants (id) on delete cascade,
      user_id uuid not null references users (id) on delete cascade,
      permission text not null,
      created_at timestamptz not null default now(),
      primary key (user_id, permission)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'user_permissions');
  await sql`grant select, insert, delete on user_permissions to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table user_permissions`.execute(db);
};
