import { type Kysely, sql } from 'kysely';

/** When each account's key was last set, so the app can remind people to rotate old keys. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table cloud_accounts add column credentials_updated_at timestamptz`.execute(db);
  await sql`alter table cloud_accounts no force row level security`.execute(db);
  await sql`
    update cloud_accounts set credentials_updated_at = coalesce(
      (
        select max(audit_events.occurred_at) from audit_events
        where audit_events.action = 'cloud.account.credentials_replaced'
          and audit_events.target_id = cloud_accounts.id::text
      ),
      cloud_accounts.created_at
    )
    where encrypted_credentials is not null
  `.execute(db);
  await sql`alter table cloud_accounts force row level security`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table cloud_accounts drop column credentials_updated_at`.execute(db);
};
