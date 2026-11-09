import { type Kysely, sql } from 'kysely';

export const enableTenantIsolation = async (db: Kysely<unknown>, table: string): Promise<void> => {
  const name = sql.table(table);
  await sql`alter table ${name} enable row level security`.execute(db);
  await sql`alter table ${name} force row level security`.execute(db);
  await sql`
    create policy tenant_isolation on ${name}
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  `.execute(db);
};
