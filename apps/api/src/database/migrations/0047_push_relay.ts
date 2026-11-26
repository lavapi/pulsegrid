import { type Kysely, sql } from 'kysely';

/** The server's registration with the push relay, which sends notifications for servers without an Apple key. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table push_relay_installations (
      relay_url text primary key,
      installation_id uuid not null,
      secret_encrypted text not null,
      created_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`grant select, insert, update, delete on push_relay_installations to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table push_relay_installations`.execute(db);
};
