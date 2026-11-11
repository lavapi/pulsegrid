import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table experiment_runs add column stopped_reason text`.execute(db);
  await sql`grant update (stopped_reason) on experiment_runs to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`revoke update (stopped_reason) on experiment_runs from devdash_app`.execute(db);
  await sql`alter table experiment_runs drop column stopped_reason`.execute(db);
};
