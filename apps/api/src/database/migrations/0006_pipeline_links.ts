import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table pipeline_links (
      tenant_id uuid not null references tenants (id) on delete cascade,
      repository text not null,
      workflow_id text not null,
      environment_id uuid references environments (id) on delete cascade,
      primary key (tenant_id, repository, workflow_id)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'pipeline_links');
  await sql`grant select, insert, update, delete on pipeline_links to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table pipeline_links`.execute(db);
};
