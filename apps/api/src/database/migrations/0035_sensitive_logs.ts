import { type Kysely, sql } from 'kysely';

const SENSITIVE_LOGS = 'logs.sensitive';

const allowAdmins = async (db: Kysely<unknown>, tenantId: string): Promise<void> => {
  await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(db);
  await sql`
    insert into role_permissions (tenant_id, role_id, permission)
    select tenant_id, id, ${SENSITIVE_LOGS} from roles
    where tenant_id = ${tenantId} and (name = 'Admin' or name like 'Admin custom %')
    on conflict do nothing
  `.execute(db);
};

export const up = async (db: Kysely<unknown>): Promise<void> => {
  const { rows: tenants } = await sql<{ id: string }>`select id from tenants`.execute(db);
  for (const { id } of tenants) {
    await allowAdmins(db, id);
  }
  await sql`select set_config('app.tenant_id', '', true)`.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await sql`delete from role_permissions where permission = ${SENSITIVE_LOGS}`.execute(db);
};
