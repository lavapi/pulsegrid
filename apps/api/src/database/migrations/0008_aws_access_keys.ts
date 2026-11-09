import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    alter table aws_accounts
      add column encrypted_key text,
      add column key_hint text,
      add column key_can_write boolean,
      drop column external_id,
      drop column access_method
  `.execute(db);
  await sql`drop table user_aws_permissions`.execute(db);
  await sql`drop table user_aws_connections`.execute(db);
  await sql`drop table aws_identity_settings`.execute(db);
};

export const down = (): Promise<void> =>
  Promise.reject(new Error('Removed AWS connections cannot be restored.'));
