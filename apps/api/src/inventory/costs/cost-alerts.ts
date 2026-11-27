import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { TenantDatabase } from '../../database/tenant-database';
import { PushNotifier } from '../../push/push-notifier';
import { REDIS } from '../../redis/redis.module';
import { currentMonth, previousMonth } from './cost-months';
import { costRise, type ServiceMonths } from './cost-rise';

/** Longer than any month, so an account is told once a month at most. */
const TOLD_FOR_SECONDS = 40 * 24 * 60 * 60;

/** Tells the people who can see costs, once a month at most, when an account's month heads well above the last. */
@Injectable()
export class CostAlerts {
  constructor(
    private readonly database: TenantDatabase,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly push: PushNotifier,
  ) {}

  async check(tenantId: string, accountId: string, now: Date): Promise<void> {
    const { name, currency, services } = await this.read(tenantId, accountId, now);
    const rise = costRise(services, now);
    if (!rise) return;
    const month = currentMonth(now);
    const first = await this.redis.set(`cost-alert:${accountId}:${month}`, '1', 'EX', TOLD_FOR_SECONDS, 'NX');
    if (first !== 'OK') return;
    const money = (amount: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
    const biggest = rise.biggest ? ` Biggest rise: ${rise.biggest.service} (+${money(rise.biggest.amount)}).` : '';
    this.push.toPermission(tenantId, 'costs.view', 'cost_increases', {
      title: `${name} costs are rising`,
      body: `On track for ${money(rise.projected)} this month, up ${Math.round(rise.share * 100)}% from ${money(rise.lastMonth)}.${biggest}`,
      path: '/costs',
      collapseId: `costs-${accountId}-${month}`,
    });
  }

  private read(tenantId: string, accountId: string, now: Date) {
    return this.database.run(tenantId, async (trx) => {
      const account = await trx.selectFrom('cloud_accounts').select('name').where('id', '=', accountId).executeTakeFirstOrThrow();
      const rows = await trx
        .selectFrom('cloud_costs')
        .select(['service', 'month', 'amount', 'currency'])
        .where('cloud_account_id', '=', accountId)
        .where('month', 'in', [currentMonth(now), previousMonth(now)])
        .execute();
      const byService = new Map<string, ServiceMonths>();
      for (const row of rows) {
        const entry = byService.get(row.service) ?? { service: row.service, thisMonth: 0, lastMonth: 0 };
        if (row.month === currentMonth(now)) entry.thisMonth += Number(row.amount);
        else entry.lastMonth += Number(row.amount);
        byService.set(row.service, entry);
      }
      return { name: account.name, currency: rows[0]?.currency ?? 'USD', services: [...byService.values()] };
    });
  }
}
