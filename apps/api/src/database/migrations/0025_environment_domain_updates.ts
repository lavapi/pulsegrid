import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`grant update on environment_domains to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`revoke update on environment_domains from devdash_app`.execute(db);
};
