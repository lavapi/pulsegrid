import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table accounts (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      email text not null,
      password_hash text,
      email_verified_at timestamptz,
      failed_attempts integer not null default 0,
      locked_until timestamptz,
      totp_secret text,
      totp_enabled_at timestamptz,
      totp_last_step bigint,
      backup_codes text[] not null default '{}',
      created_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create unique index accounts_email_key on accounts (lower(email))`.execute(db);

  await sql`
    create table account_identities (
      provider text not null,
      subject text not null,
      account_id uuid not null references accounts (id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (provider, subject)
    )
  `.execute(db);

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

  await sql`
    create table invitations (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      email text not null,
      role text not null check (role in ('viewer', 'developer', 'admin')),
      token_hash text not null unique,
      expires_at timestamptz not null,
      accepted_at timestamptz,
      created_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`
    create unique index invitations_pending_key on invitations (tenant_id, lower(email))
    where accepted_at is null
  `.execute(db);
  await enableTenantIsolation(db, 'invitations');

  await sql`
    alter table users
      add column account_id uuid references accounts (id) on delete set null,
      add column role text not null default 'viewer'
        check (role in ('viewer', 'developer', 'admin'))
  `.execute(db);
  await sql`
    update users set role = latest.role
    from (
      select distinct on (user_id) user_id, role
      from sessions order by user_id, created_at desc
    ) latest
    where latest.user_id = users.id
  `.execute(db);
  await sql`
    update users set role = 'admin'
    where id in (
      select distinct on (tenant_id) id from users
      where tenant_id not in (select tenant_id from users where role = 'admin')
      order by tenant_id, created_at
    )
  `.execute(db);
  await sql`
    insert into accounts (tenant_id, email, email_verified_at)
    select distinct on (lower(email)) tenant_id, lower(email), now()
    from users order by lower(email), last_login_at desc
  `.execute(db);
  await sql`
    update users set account_id = accounts.id
    from accounts
    where accounts.tenant_id = users.tenant_id and accounts.email = lower(users.email)
  `.execute(db);

  await sql`alter table users drop column idp_subject`.execute(db);
  await sql`alter table sessions drop column role`.execute(db);
  await sql`drop table group_role_mappings`.execute(db);
  await sql`drop table saml_connections`.execute(db);

  await sql`grant insert on tenants to devdash_app`.execute(db);
  await sql`grant select, insert, update, delete on users to devdash_app`.execute(db);
  await sql`grant delete on sessions to devdash_app`.execute(db);
  await sql`grant select, insert, update, delete on accounts to devdash_app`.execute(db);
  await sql`grant select, insert, delete on account_identities to devdash_app`.execute(db);
  await sql`grant select, insert, update, delete on account_tokens to devdash_app`.execute(db);
  await sql`grant select, insert, update, delete on invitations to devdash_app`.execute(db);
};

export const down = (): Promise<void> =>
  Promise.reject(new Error('The previous sign-in setup cannot be restored.'));
