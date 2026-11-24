import { type Kysely, sql } from 'kysely';

/** Whether an account is connected with an access key or a role; every existing account has a key. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table cloud_accounts
      add column credential_kind text not null default 'key' check (credential_kind in ('key', 'role'))
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table cloud_accounts drop column credential_kind`.execute(db);
};
