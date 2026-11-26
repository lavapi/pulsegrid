import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

const TABLES = ['slack_apps', 'notification_settings', 'notifications_sent'];

/** The project's Slack app, each person's notification settings, and what has been sent so nothing goes twice. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table slack_apps (
      tenant_id uuid primary key references tenants (id) on delete cascade,
      encrypted_token text not null,
      workspace text not null,
      updated_by_email text,
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`
    create table notification_settings (
      tenant_id uuid not null references tenants (id) on delete cascade,
      user_id uuid primary key references users (id) on delete cascade,
      github_login text check (github_login ~ '^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$'),
      pr_ready boolean not null default true,
      pr_failed boolean not null default true,
      deploy_ready boolean not null default true,
      deploy_failed boolean not null default true,
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create unique index notification_settings_github_login on notification_settings (tenant_id, lower(github_login))`.execute(
    db,
  );
  await sql`
    create table notifications_sent (
      tenant_id uuid not null references tenants (id) on delete cascade,
      key text not null,
      sent_at timestamptz not null default now(),
      primary key (tenant_id, key)
    )
  `.execute(db);
  for (const table of TABLES) {
    await enableTenantIsolation(db, table);
    await sql`grant select, insert, update, delete on ${sql.table(table)} to devdash_app`.execute(db);
  }
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of [...TABLES].reverse()) {
    await sql`drop table ${sql.table(table)}`.execute(db);
  }
};
