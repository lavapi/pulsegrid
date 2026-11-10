import { type Kysely, sql } from 'kysely';

const NON_PRODUCTION = String.raw`\m(dev|develop|development|qa|test|testing|uat|stage|staging|stg)\M`;
const PRODUCTION = String.raw`\m(prod|prd|production|live)\M`;

const setForced = (db: Kysely<unknown>, forced: boolean) =>
  sql`alter table environments ${sql.raw(forced ? 'force' : 'no force')} row level security`.execute(db);

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table environments add column is_production boolean not null default true`.execute(db);
  await setForced(db, false);
  await sql`
    update environments set is_production = false
    where name ~* ${NON_PRODUCTION} and name !~* ${PRODUCTION}
  `.execute(db);
  await setForced(db, true);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table environments drop column is_production`.execute(db);
};
