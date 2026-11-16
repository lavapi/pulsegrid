import type { AlertSeverity, AlertSource, AlertStatus, SecurityAlertStatusChange } from '@pulsegrid/shared';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../database/tenant-context';
import type { NormalizedAlert } from './alert-normalizer';

export interface AlertFilter {
  severity?: AlertSeverity | undefined;
  source?: AlertSource | undefined;
  accountId?: string | undefined;
  region?: string | undefined;
  status?: AlertStatus | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  cursor?: string | undefined;
}

/** An alert that arrived for the first time, which may need a notification. */
export interface CreatedAlert {
  id: string;
  severity: AlertSeverity;
}

const ALERT_COLUMNS = [
  'id',
  'source',
  'severity',
  'title',
  'account_id',
  'region',
  'occurred_at',
  'last_seen_at',
  'status',
] as const;

const encodeCursor = (occurredAt: Date, id: string): string =>
  Buffer.from(`${occurredAt.toISOString()}|${id}`).toString('base64url');

const decodeCursor = (cursor: string): { occurredAt: Date; id: string } | null => {
  const [at = '', id = ''] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const occurredAt = new Date(at);
  return Number.isNaN(occurredAt.getTime()) || !id ? null : { occurredAt, id };
};

/** Security alerts in one project: stored once per finding or event, and newest first. */
@Injectable()
export class SecurityAlertsStore {
  /** Records the SNS message; false when it was handled before, so a redelivery changes nothing. */
  async firstDelivery(trx: TenantTransaction, tenantId: string, messageId: string): Promise<boolean> {
    const inserted = await trx
      .insertInto('security_alert_messages')
      .values({ tenant_id: tenantId, message_id: messageId })
      .onConflict((conflict) => conflict.doNothing())
      .returning('message_id')
      .executeTakeFirst();
    return Boolean(inserted);
  }

  /** Stores the alert, or updates it when AWS sends a newer version; returns it only when it is new. */
  async upsert(trx: TenantTransaction, tenantId: string, alert: NormalizedAlert): Promise<CreatedAlert | null> {
    const row = await trx
      .insertInto('security_alerts')
      .values({
        tenant_id: tenantId,
        alert_key: alert.key,
        source: alert.source,
        severity: alert.severity,
        title: alert.title,
        account_id: alert.accountId,
        region: alert.region,
        occurred_at: alert.occurredAt,
        aws_updated_at: alert.updatedAt,
        console_url: alert.consoleUrl,
        facts: JSON.stringify(alert.facts),
        raw_event: JSON.stringify(alert.rawEvent),
      })
      .onConflict((conflict) =>
        conflict
          .columns(['tenant_id', 'alert_key'])
          .doUpdateSet((eb) => ({
            severity: eb.ref('excluded.severity'),
            title: eb.ref('excluded.title'),
            region: eb.ref('excluded.region'),
            aws_updated_at: eb.ref('excluded.aws_updated_at'),
            console_url: eb.ref('excluded.console_url'),
            facts: eb.ref('excluded.facts'),
            raw_event: eb.ref('excluded.raw_event'),
            last_seen_at: sql<Date>`now()`,
          }))
          .where('security_alerts.aws_updated_at', '<=', (eb) => eb.ref('excluded.aws_updated_at')),
      )
      .returning(['id', 'severity', sql<boolean>`xmax = 0`.as('inserted')])
      .executeTakeFirst();
    return row?.inserted ? { id: row.id, severity: row.severity } : null;
  }

  /** Updates an alert that already exists, when AWS's version is newer; never creates one. */
  async updateExisting(trx: TenantTransaction, alert: NormalizedAlert): Promise<boolean> {
    const result = await trx
      .updateTable('security_alerts')
      .set({
        severity: alert.severity,
        title: alert.title,
        region: alert.region,
        aws_updated_at: alert.updatedAt,
        console_url: alert.consoleUrl,
        facts: JSON.stringify(alert.facts),
        raw_event: JSON.stringify(alert.rawEvent),
        last_seen_at: sql<Date>`now()`,
      })
      .where('alert_key', '=', alert.key)
      .where('aws_updated_at', '<', alert.updatedAt)
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  /** The finding IDs of alerts not yet resolved, whose state in AWS the check follows. */
  async openFindingKeys(trx: TenantTransaction): Promise<string[]> {
    const rows = await trx
      .selectFrom('security_alerts')
      .select('alert_key')
      .where('status', '!=', 'resolved')
      .where('source', 'in', ['guardduty', 'securityhub'])
      .execute();
    return rows.map(({ alert_key }) => alert_key);
  }

  async list(trx: TenantTransaction, filter: AlertFilter, limit: number) {
    let query = trx
      .selectFrom('security_alerts')
      .select(ALERT_COLUMNS)
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1);
    const after = filter.cursor ? decodeCursor(filter.cursor) : null;
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb('occurred_at', '<', after.occurredAt),
          eb.and([eb('occurred_at', '=', after.occurredAt), eb('id', '<', after.id)]),
        ]),
      );
    }
    if (filter.severity) query = query.where('severity', '=', filter.severity);
    if (filter.source) query = query.where('source', '=', filter.source);
    if (filter.accountId) query = query.where('account_id', '=', filter.accountId);
    if (filter.region) query = query.where('region', '=', filter.region);
    if (filter.status) query = query.where('status', '=', filter.status);
    if (filter.from) query = query.where('occurred_at', '>=', filter.from);
    if (filter.to) query = query.where('occurred_at', '<', filter.to);
    const rows = await query.execute();
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { rows: page, nextCursor: rows.length > limit && last ? encodeCursor(last.occurred_at, last.id) : null };
  }

  find(trx: TenantTransaction, id: string) {
    return trx.selectFrom('security_alerts').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async history(trx: TenantTransaction, alertId: string): Promise<SecurityAlertStatusChange[]> {
    const rows = await trx
      .selectFrom('security_alert_status_changes')
      .select(['from_status', 'to_status', 'changed_by', 'changed_at'])
      .where('alert_id', '=', alertId)
      .orderBy('changed_at', 'desc')
      .execute();
    return rows.map((row) => ({
      from: row.from_status,
      to: row.to_status,
      changedBy: row.changed_by,
      changedAt: row.changed_at.toISOString(),
    }));
  }

  /** Moves the alert to a new status and keeps the change; null when the alert is gone. */
  async changeStatus(
    trx: TenantTransaction,
    tenantId: string,
    id: string,
    to: AlertStatus,
    changedBy: string,
  ): Promise<{ from: AlertStatus } | null> {
    const current = await trx
      .selectFrom('security_alerts')
      .select('status')
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!current) {
      return null;
    }
    if (current.status === to) {
      return { from: current.status };
    }
    await trx
      .updateTable('security_alerts')
      .set({ status: to, status_changed_by: changedBy, status_changed_at: new Date() })
      .where('id', '=', id)
      .execute();
    await trx
      .insertInto('security_alert_status_changes')
      .values({ tenant_id: tenantId, alert_id: id, from_status: current.status, to_status: to, changed_by: changedBy })
      .execute();
    return { from: current.status };
  }

  async filterOptions(trx: TenantTransaction) {
    const [accounts, regions] = await Promise.all([
      trx.selectFrom('security_alerts').select('account_id').distinct().orderBy('account_id').execute(),
      trx
        .selectFrom('security_alerts')
        .select('region')
        .distinct()
        .where('region', 'is not', null)
        .orderBy('region')
        .execute(),
    ]);
    return {
      accountIds: accounts.map(({ account_id }) => account_id),
      regions: regions.flatMap(({ region }) => (region ? [region] : [])),
    };
  }

  async countNew(trx: TenantTransaction, severities: readonly AlertSeverity[]): Promise<number> {
    const row = await trx
      .selectFrom('security_alerts')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('status', '=', 'new')
      .where('severity', 'in', severities)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }
}
