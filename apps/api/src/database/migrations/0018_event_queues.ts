import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table cloud_accounts add column event_queue_url text`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table cloud_accounts drop column event_queue_url`.execute(db);
};
