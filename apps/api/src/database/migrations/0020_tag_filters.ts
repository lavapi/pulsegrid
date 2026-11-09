import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table cloud_accounts
    add column tag_filter jsonb not null
    default '{"include":[],"exclude":[],"keepUntagged":false}'
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table cloud_accounts drop column tag_filter`.execute(db);
};
