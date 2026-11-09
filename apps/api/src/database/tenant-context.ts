import { type Kysely, sql, type Transaction } from 'kysely';
import type { Database } from './schema';

export type TenantTransaction = Transaction<Database>;

export const applyTenantContext = async (
  trx: TenantTransaction,
  tenantId: string,
): Promise<void> => {
  await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(trx);
};

export const withTenantContext = <T>(
  db: Kysely<Database>,
  tenantId: string,
  work: (trx: TenantTransaction) => Promise<T>,
): Promise<T> =>
  db.transaction().execute(async (trx) => {
    await applyTenantContext(trx, tenantId);
    return work(trx);
  });
