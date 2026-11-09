import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

const TENANT_SCOPED_TABLES = [
  'saml_connections',
  'group_role_mappings',
  'users',
  'sessions',
  'audit_events',
] as const;

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table tenants (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
      name text not null,
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table saml_connections (
      tenant_id uuid primary key references tenants (id) on delete cascade,
      idp_entity_id text not null,
      idp_sso_url text not null,
      idp_certificate text not null,
      created_at timestamptz not null default now()
    )
  `.execute(db);

  await sql`
    create table group_role_mappings (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      idp_group_id text not null,
      label text not null,
      role text not null check (role in ('viewer', 'developer', 'admin')),
      created_at timestamptz not null default now(),
      unique (tenant_id, idp_group_id)
    )
  `.execute(db);

  await sql`
    create table users (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      idp_subject text not null,
      email text not null,
      display_name text not null,
      created_at timestamptz not null default now(),
      last_login_at timestamptz not null,
      unique (tenant_id, idp_subject)
    )
  `.execute(db);

  await sql`
    create table sessions (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      user_id uuid not null references users (id) on delete cascade,
      token_hash text not null unique,
      role text not null check (role in ('viewer', 'developer', 'admin')),
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    )
  `.execute(db);
  await sql`create index sessions_expires_at_idx on sessions (expires_at)`.execute(db);

  await sql`
    create table audit_events (
      id bigint generated always as identity primary key,
      tenant_id uuid not null references tenants (id) on delete cascade,
      actor_user_id uuid references users (id) on delete set null,
      actor_email text,
      action text not null,
      target_type text,
      target_id text,
      ip_address text,
      metadata jsonb not null default '{}',
      occurred_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create index audit_events_tenant_idx on audit_events (tenant_id, id desc)`.execute(db);

  for (const table of TENANT_SCOPED_TABLES) {
    await enableTenantIsolation(db, table);
  }

  await sql`grant select on tenants, saml_connections to devdash_app`.execute(db);
  await sql`grant select, insert, update, delete on group_role_mappings to devdash_app`.execute(db);
  await sql`grant select, insert, update on users to devdash_app`.execute(db);
  await sql`grant select, insert, delete on sessions to devdash_app`.execute(db);
  await sql`grant select, insert on audit_events to devdash_app`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of [...TENANT_SCOPED_TABLES].reverse()) {
    await sql`drop table ${sql.table(table)}`.execute(db);
  }
  await sql`drop table tenants`.execute(db);
};
