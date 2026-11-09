import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../../database/database.module';
import type { CloudAccountRow, Database } from '../../database/schema';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import type { CostEntry, CostSource } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { costPeriod, currentMonth, previousMonth } from './cost-months';

const HOUR_MS = 60 * 60 * 1000;
const REFRESH_AFTER_MS = 5.5 * HOUR_MS;
const RETRY_AFTER_MS = 0.9 * HOUR_MS;

export const isCostRefreshDue = (
  { costs_checked_at: checkedAt, costs_error: error }: Pick<CloudAccountRow, 'costs_checked_at' | 'costs_error'>,
  now: Date,
): boolean =>
  !checkedAt || now.getTime() - checkedAt.getTime() >= (error ? RETRY_AFTER_MS : REFRESH_AFTER_MS);

@Injectable()
export class CostRefreshService {
  private readonly logger = new Logger(CostRefreshService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly vault: CredentialVault,
    private readonly providers: ProviderRegistry,
  ) {}

  async refreshDueAccounts(now = new Date()): Promise<void> {
    const tenants = await this.db.selectFrom('tenants').select('id').execute();
    for (const { id: tenantId } of tenants) {
      const accounts = await this.database.run(tenantId, (trx) =>
        trx
          .selectFrom('cloud_accounts')
          .selectAll()
          .where('status', '=', 'connected')
          .where('encrypted_credentials', 'is not', null)
          .execute(),
      );
      for (const account of accounts.filter((row) => isCostRefreshDue(row, now))) {
        await this.refreshAccount(tenantId, account, now);
      }
    }
  }

  private async refreshAccount(tenantId: string, account: CloudAccountRow, now: Date): Promise<void> {
    const source = this.providers.get(account.provider).costSource;
    const credentials = this.vault.open(account);
    if (!source || !credentials) {
      return;
    }
    try {
      const entries = await source.read(
        { credentials, accountId: account.account_id },
        costPeriod(now),
      );
      await this.save(tenantId, account.id, entries, now);
    } catch (error) {
      await this.saveFailure(tenantId, account.id, source, error, now);
    }
  }

  private save(tenantId: string, accountId: string, entries: CostEntry[], now: Date): Promise<void> {
    return this.database.run(tenantId, async (trx) => {
      await trx
        .deleteFrom('cloud_costs')
        .where('cloud_account_id', '=', accountId)
        .where('month', 'in', [currentMonth(now), previousMonth(now)])
        .execute();
      if (entries.length > 0) {
        await trx
          .insertInto('cloud_costs')
          .values(
            entries.map(({ month, service, category, amount, currency }) => ({
              tenant_id: tenantId,
              cloud_account_id: accountId,
              month,
              service,
              category,
              amount,
              currency,
            })),
          )
          .execute();
      }
      await trx
        .updateTable('cloud_accounts')
        .set({ costs_checked_at: now, costs_updated_at: now, costs_error: null })
        .where('id', '=', accountId)
        .execute();
    });
  }

  private async saveFailure(
    tenantId: string,
    accountId: string,
    source: CostSource,
    error: unknown,
    now: Date,
  ): Promise<void> {
    this.logger.warn(`Cost read failed: ${(error as Error).name}`);
    await this.database.run(tenantId, (trx) =>
      trx
        .updateTable('cloud_accounts')
        .set({ costs_checked_at: now, costs_error: source.failureMessage(error) })
        .where('id', '=', accountId)
        .execute(),
    );
  }
}
