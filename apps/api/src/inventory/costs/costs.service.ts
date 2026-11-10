import type { AccountCosts, CostOverview, ServiceCost } from '@pulsegrid/shared';
import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { TenantDatabase } from '../../database/tenant-database';
import { currentMonth, previousMonth } from './cost-months';

interface CostRow {
  cloud_account_id: string;
  month: string;
  service: string;
  category: string | null;
  amount: string;
  currency: string;
}

const servicesFrom = (rows: readonly CostRow[], month: string): ServiceCost[] => {
  const services = new Map<string, ServiceCost>();
  for (const { service, category, amount, month: rowMonth } of rows) {
    const cost = services.get(service) ?? { service, category, thisMonth: 0, lastMonth: 0 };
    services.set(service, {
      ...cost,
      thisMonth: rowMonth === month ? Number(amount) : cost.thisMonth,
      lastMonth: rowMonth === month ? cost.lastMonth : Number(amount),
    });
  }
  return [...services.values()].sort((first, second) => second.thisMonth - first.thisMonth);
};

@Injectable()
export class CostsService {
  constructor(private readonly database: TenantDatabase) {}

  async overview(auth: AuthContext, now = new Date()): Promise<CostOverview> {
    const month = currentMonth(now);
    const lastMonth = previousMonth(now);
    const { accounts, costs } = await this.database.run(auth.tenantId, async (trx) => ({
      accounts: await trx
        .selectFrom('cloud_accounts')
        .leftJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
        .select([
          'cloud_accounts.id',
          'cloud_accounts.name',
          'cloud_accounts.environment_id',
          'cloud_accounts.costs_updated_at',
          'cloud_accounts.costs_error',
          'environments.name as environment_name',
          'environments.is_production',
        ])
        .orderBy('cloud_accounts.name')
        .execute(),
      costs: await trx
        .selectFrom('cloud_costs')
        .select(['cloud_account_id', 'month', 'service', 'category', 'amount', 'currency'])
        .where('month', 'in', [month, lastMonth])
        .execute(),
    }));

    return {
      month,
      lastMonth,
      accounts: accounts.map((account): AccountCosts => {
        const rows = costs.filter(({ cloud_account_id: id }) => id === account.id);
        return {
          accountId: account.id,
          accountName: account.name,
          environmentId: account.environment_id,
          environmentName: account.environment_name,
          isProduction: account.is_production ?? false,
          currency: rows[0]?.currency ?? null,
          services: servicesFrom(rows, month),
          updatedAt: account.costs_updated_at?.toISOString() ?? null,
          error: account.costs_error,
        };
      }),
    };
  }
}
