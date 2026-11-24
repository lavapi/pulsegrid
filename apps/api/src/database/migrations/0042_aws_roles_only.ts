import { type Kysely, sql } from 'kysely';

/**
 * AWS accounts connect only through roles now: a key still stored is cleared, so the account asks to be connected
 * again instead of failing, and the key age it was tracked by goes.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table cloud_accounts no force row level security`.execute(db);
  await sql`
    update cloud_accounts
    set encrypted_credentials = null, credential_hint = null, credential_kind = 'role'
    where provider = 'aws' and credential_kind = 'key' and encrypted_credentials is not null
  `.execute(db);
  await sql`alter table cloud_accounts force row level security`.execute(db);
  await sql`alter table cloud_accounts drop column credentials_updated_at`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table cloud_accounts add column credentials_updated_at timestamptz`.execute(db);
};
