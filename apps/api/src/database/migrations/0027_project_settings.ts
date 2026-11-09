import { type Kysely, sql } from 'kysely';

const FUNCTIONS = ['rename_project(uuid, text)', 'delete_project(uuid)'];

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create function rename_project(target uuid, new_name text) returns void
    language sql security definer set search_path = public
    as $$ update tenants set name = new_name where id = target $$
  `.execute(db);
  await sql`
    create function delete_project(target uuid) returns void
    language sql security definer set search_path = public
    as $$
      update sessions set tenant_id = null where tenant_id = target;
      delete from tenants where id = target;
    $$
  `.execute(db);
  for (const name of FUNCTIONS) {
    await sql.raw(`revoke all on function ${name} from public`).execute(db);
    await sql.raw(`grant execute on function ${name} to devdash_app`).execute(db);
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  for (const name of FUNCTIONS) {
    await sql.raw(`drop function ${name}`).execute(db);
  }
};
