import { NOTIFYING_SEVERITIES } from '@pulsegrid/shared';
import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../database/tenant-context';
import type { NormalizedAlert } from './alert-normalizer';
import { SecurityAlertsQueue } from './security-alerts.queue';
import { type CreatedAlert, SecurityAlertsStore } from './security-alerts.store';

export interface IntakeResult {
  created: number;
  updated: number;
}

/**
 * Where alerts enter, whether AWS pushed them or the check fetched them: stored or updated, and new urgent ones
 * queued for notification in the same transaction, so a failure leaves nothing half done.
 */
@Injectable()
export class SecurityAlertsIntake {
  constructor(
    private readonly store: SecurityAlertsStore,
    private readonly queue: SecurityAlertsQueue,
  ) {}

  async save(trx: TenantTransaction, tenantId: string, alerts: readonly NormalizedAlert[]): Promise<IntakeResult> {
    const created: CreatedAlert[] = [];
    for (const alert of alerts) {
      const row = await this.store.upsert(trx, tenantId, alert);
      if (row) created.push(row);
    }
    await this.notify(tenantId, created);
    return { created: created.length, updated: alerts.length - created.length };
  }

  /** Brings existing alerts up to date with AWS; creates nothing and notifies nobody. */
  async refresh(trx: TenantTransaction, alerts: readonly NormalizedAlert[]): Promise<number> {
    let updated = 0;
    for (const alert of alerts) {
      if (await this.store.updateExisting(trx, alert)) updated += 1;
    }
    return updated;
  }

  private async notify(tenantId: string, created: readonly CreatedAlert[]): Promise<void> {
    for (const alert of created.filter(({ severity }) => NOTIFYING_SEVERITIES.includes(severity))) {
      await this.queue.notify({ tenantId, alertId: alert.id });
    }
  }
}
