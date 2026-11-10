import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table accounts add column two_factor_failed_attempts integer not null default 0`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table accounts drop column two_factor_failed_attempts`.execute(db);
};
