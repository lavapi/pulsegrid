import { type Kysely, sql } from 'kysely';

/**
 * Signing in from the iPhone app: sessions say which app they belong to, a one-time code carries a browser
 * sign-in over to the app, and each phone can register for push notifications.
 */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`alter table sessions add column client text not null default 'web' check (client in ('web', 'ios'))`.execute(db);
  await sql`alter table sessions add column device_name text check (length(device_name) <= 60)`.execute(db);
  await sql`alter table sessions add column last_used_at timestamptz`.execute(db);

  await sql`
    create table device_sign_in_codes (
      code_hash text primary key,
      account_id uuid not null references accounts (id) on delete cascade,
      tenant_id uuid references tenants (id) on delete cascade,
      challenge text not null,
      device_name text not null check (length(device_name) between 1 and 60),
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`grant select, insert, delete on device_sign_in_codes to devdash_app`.execute(db);

  await sql`
    create table push_devices (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null references accounts (id) on delete cascade,
      session_id uuid not null unique references sessions (id) on delete cascade,
      apns_token text not null unique check (apns_token ~ '^[0-9a-f]{64,200}$'),
      environment text not null check (environment in ('sandbox', 'production')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create index push_devices_account on push_devices (account_id)`.execute(db);
  await sql`grant select, insert, update, delete on push_devices to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`drop table push_devices`.execute(db);
  await sql`drop table device_sign_in_codes`.execute(db);
  await sql`alter table sessions drop column last_used_at, drop column device_name, drop column client`.execute(db);
};
