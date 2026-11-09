import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table users add column is_owner boolean not null default false`.execute(db);
  await sql`
    update users set is_owner = true
    where id in (
      select distinct on (tenant_id) id from users
      where role = 'admin'
      order by tenant_id, created_at
    )
  `.execute(db);
  await sql`create unique index users_owner_key on users (tenant_id) where is_owner`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table users drop column is_owner`.execute(db);
};
