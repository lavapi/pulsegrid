import { type Kysely, sql } from 'kysely';

const CURRENT_PROJECT = "nullif(current_setting('app.tenant_id', true), '')::uuid";

const defineFunctions = async (db: Kysely<unknown>, guard: string): Promise<void> => {
  await sql`
    create or replace function rename_project(target uuid, new_name text) returns void
    language sql security definer set search_path = public
    as $$ update tenants set name = new_name where id = target ${sql.raw(guard)} $$
  `.execute(db);
  await sql`
    create or replace function delete_project(target uuid) returns void
    language sql security definer set search_path = public
    as $$
      update sessions set tenant_id = null where tenant_id = target ${sql.raw(guard)};
      delete from tenants where id = target ${sql.raw(guard)};
    $$
  `.execute(db);
};

export const up = (db: Kysely<unknown>): Promise<void> =>
  defineFunctions(db, `and target = ${CURRENT_PROJECT}`);

export const down = (db: Kysely<unknown>): Promise<void> => defineFunctions(db, '');
