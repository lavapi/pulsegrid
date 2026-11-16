import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

const SECURITY_PERMISSIONS = ['security.view', 'security.manage'];
const TABLES = ['security_alerts', 'security_alert_status_changes', 'security_alert_messages', 'slack_integrations'];

const allowAdmins = async (db: Kysely<unknown>, tenantId: string): Promise<void> => {
  await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(db);
  for (const permission of SECURITY_PERMISSIONS) {
    await sql`
      insert into role_permissions (tenant_id, role_id, permission)
      select tenant_id, id, ${permission} from roles
      where tenant_id = ${tenantId} and (name = 'Admin' or name like 'Admin custom %')
      on conflict do nothing
    `.execute(db);
  }
};

/** Security alerts pushed by AWS, their status history, the SNS messages already handled, and Slack. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table security_alerts (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      alert_key text not null,
      source text not null check (source in ('guardduty', 'securityhub', 'root-activity', 'other')),
      severity text not null check (severity in ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL')),
      title text not null,
      account_id text not null,
      region text,
      occurred_at timestamptz not null,
      aws_updated_at timestamptz not null,
      console_url text,
      facts jsonb not null default '{}',
      raw_event jsonb not null,
      status text not null default 'new' check (status in ('new', 'acknowledged', 'resolved')),
      status_changed_by text,
      status_changed_at timestamptz,
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      unique (tenant_id, alert_key)
    )
  `.execute(db);
  await sql`create index security_alerts_list_idx on security_alerts (tenant_id, occurred_at desc, id desc)`.execute(db);
  await sql`
    create table security_alert_status_changes (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references tenants (id) on delete cascade,
      alert_id uuid not null references security_alerts (id) on delete cascade,
      from_status text not null,
      to_status text not null,
      changed_by text not null,
      changed_at timestamptz not null default now()
    )
  `.execute(db);
  await sql`create index security_alert_status_changes_alert_idx on security_alert_status_changes (alert_id, changed_at)`.execute(db);
  await sql`
    create table security_alert_messages (
      tenant_id uuid not null references tenants (id) on delete cascade,
      message_id text not null,
      received_at timestamptz not null default now(),
      primary key (tenant_id, message_id)
    )
  `.execute(db);
  await sql`
    create table slack_integrations (
      tenant_id uuid primary key references tenants (id) on delete cascade,
      encrypted_webhook_url text not null,
      updated_by_email text,
      updated_at timestamptz not null default now()
    )
  `.execute(db);
  for (const table of TABLES) {
    await enableTenantIsolation(db, table);
    await sql`grant select, insert, update, delete on ${sql.table(table)} to devdash_app`.execute(db);
  }

  const { rows: tenants } = await sql<{ id: string }>`select id from tenants`.execute(db);
  for (const { id } of tenants) {
    await allowAdmins(db, id);
  }
  await sql`select set_config('app.tenant_id', '', true)`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  for (const table of [...TABLES].reverse()) {
    await sql`drop table ${sql.table(table)}`.execute(db);
  }
  await sql`delete from role_permissions where permission in ('security.view', 'security.manage')`.execute(db);
};
