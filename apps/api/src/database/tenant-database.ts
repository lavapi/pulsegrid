import type { Kysely } from 'kysely';
import type { Database } from './schema';
import { type TenantTransaction, withTenantContext } from './tenant-context';

export class TenantDatabase {
  constructor(private readonly db: Kysely<Database>) {}

  run<T>(tenantId: string, work: (trx: TenantTransaction) => Promise<T>): Promise<T> {
    return withTenantContext(this.db, tenantId, work);
  }
}
