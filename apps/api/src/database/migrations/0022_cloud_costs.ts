import { type Kysely, sql } from 'kysely';
import { enableTenantIsolation } from './tenant-isolation';

const COSTS_VIEW = 'costs.view';

const allowAdmins = async (db: Kysely<unknown>, tenantId: string): Promise<void> => {
  await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(db);
  await sql`
    insert into role_permissions (tenant_id, role_id, permission)
    select tenant_id, id, ${COSTS_VIEW} from roles
    where tenant_id = ${tenantId} and (name = 'Admin' or name like 'Admin custom %')
  `.execute(db);
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    create table cloud_costs (
      tenant_id uuid not null references tenants (id) on delete cascade,
      cloud_account_id uuid not null references cloud_accounts (id) on delete cascade,
      month text not null,
      service text not null,
      category text,
      amount numeric(14, 4) not null,
      currency text not null,
      primary key (cloud_account_id, month, service)
    )
  `.execute(db);
  await enableTenantIsolation(db, 'cloud_costs');
  await sql`grant select, insert, delete on cloud_costs to devdash_app`.execute(db);
  await sql`
    alter table cloud_accounts
    add column costs_checked_at timestamptz,
    add column costs_updated_at timestamptz,
    add column costs_error text
  `.execute(db);

  const { rows: tenants } = await sql<{ id: string }>`select id from tenants`.execute(db);
  for (const { id } of tenants) {
    await allowAdmins(db, id);
  }
  await sql`select set_config('app.tenant_id', '', true)`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`delete from role_permissions where permission = ${COSTS_VIEW}`.execute(db);
  await sql`
    alter table cloud_accounts
    drop column costs_checked_at,
    drop column costs_updated_at,
    drop column costs_error
  `.execute(db);
  await sql`drop table cloud_costs`.execute(db);
};
