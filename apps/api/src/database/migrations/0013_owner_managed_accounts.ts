import { type Kysely, sql } from 'kysely';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table account_tokens`.execute(db);
  await sql`alter table accounts drop column email_verified_at`.execute(db);
  await sql`alter table accounts add column temporary_password_expires_at timestamptz`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table accounts drop column temporary_password_expires_at`.execute(db);
  await sql`alter table accounts add column email_verified_at timestamptz`.execute(db);
  await sql`update accounts set email_verified_at = created_at`.execute(db);
  await sql`
    create table account_tokens (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null references accounts (id) on delete cascade,
      purpose text not null check (purpose in ('verify_email', 'reset_password')),
      token_hash text not null unique,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`grant select, insert, update, delete on account_tokens to devdash_app`.execute(db);
};
