import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table action_runs add column title text`.execute(db);
  await sql`alter table action_runs alter column permission drop not null`.execute(db);
  await sql`alter table action_runs alter column started_by_email drop not null`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`delete from action_runs where permission is null`.execute(db);
  await sql`alter table action_runs alter column started_by_email set not null`.execute(db);
  await sql`alter table action_runs alter column permission set not null`.execute(db);
  await sql`alter table action_runs drop column title`.execute(db);
};
