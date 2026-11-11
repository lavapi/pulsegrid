import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table experiment_runs add column wave_size integer check (wave_size > 0)`.execute(db);
  await sql`alter table experiment_groups add column wave_size integer check (wave_size > 0)`.execute(db);
  await sql`
    create index experiment_runs_waiting on experiment_runs (tenant_id)
    where items @> '[{"waiting": true}]'
  `.execute(db);
  await sql`grant update (items) on experiment_runs to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`revoke update (items) on experiment_runs from devdash_app`.execute(db);
  await sql`drop index experiment_runs_waiting`.execute(db);
  await sql`alter table experiment_groups drop column wave_size`.execute(db);
  await sql`alter table experiment_runs drop column wave_size`.execute(db);
};
