import {
  type AlertStatus,
  NOTIFYING_SEVERITIES,
  type SecurityAlert,
  type SecurityAlertDetail,
  type SecurityAlertFilterOptions,
  type SecurityAlertPage,
} from '@pulsegrid/shared';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Selectable } from 'kysely';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import type { SecurityAlertsTable } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { AccountNames } from './account-names';
import { type AlertFilter, SecurityAlertsStore } from './security-alerts.store';

const PAGE_SIZE = 50;
const NOT_FOUND = 'This alert no longer exists.';

type AlertRow = Pick<
  Selectable<SecurityAlertsTable>,
  'id' | 'source' | 'severity' | 'title' | 'account_id' | 'region' | 'occurred_at' | 'last_seen_at' | 'status'
>;

/** The alerts page: the list, one alert, and moving an alert through new, acknowledged and resolved. */
@Injectable()
export class SecurityAlertsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly store: SecurityAlertsStore,
    private readonly accounts: AccountNames,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, filter: AlertFilter): Promise<SecurityAlertPage> {
    return this.database.run(auth.tenantId, async (trx) => {
      const { rows, nextCursor } = await this.store.list(trx, filter, PAGE_SIZE);
      return { alerts: rows.map((row) => this.toAlert(row)), nextCursor };
    });
  }

  options(auth: AuthContext): Promise<SecurityAlertFilterOptions> {
    return this.database.run(auth.tenantId, async (trx) => {
      const { accountIds, regions } = await this.store.filterOptions(trx);
      return { accounts: accountIds.map((id) => ({ id, name: this.accounts.of(id) })), regions };
    });
  }

  /** New alerts that notify, for the count next to the menu entry. */
  unseen(auth: AuthContext): Promise<{ count: number }> {
    return this.database.run(auth.tenantId, async (trx) => ({
      count: await this.store.countNew(trx, NOTIFYING_SEVERITIES),
    }));
  }

  detail(auth: AuthContext, id: string): Promise<SecurityAlertDetail> {
    return this.database.run(auth.tenantId, async (trx) => {
      const row = await this.store.find(trx, id);
      if (!row) {
        throw new NotFoundException(NOT_FOUND);
      }
      return {
        ...this.toAlert(row),
        consoleUrl: row.console_url,
        facts: row.facts,
        rawEvent: row.raw_event,
        statusChangedBy: row.status_changed_by,
        statusChangedAt: row.status_changed_at?.toISOString() ?? null,
        history: await this.store.history(trx, id),
      };
    });
  }

  async changeStatus(auth: AuthContext, id: string, status: AlertStatus, ipAddress: string | undefined) {
    await this.database.run(auth.tenantId, async (trx) => {
      const changed = await this.store.changeStatus(trx, auth.tenantId, id, status, auth.email);
      if (!changed) {
        throw new NotFoundException(NOT_FOUND);
      }
      if (changed.from !== status) {
        await this.audit.record(trx, {
          tenantId: auth.tenantId,
          action: 'security.alert.status_changed',
          actor: { userId: auth.userId, email: auth.email },
          target: { type: 'security_alert', id },
          ipAddress,
          metadata: { from: changed.from, to: status },
        });
      }
    });
    return this.detail(auth, id);
  }

  private toAlert(row: AlertRow): SecurityAlert {
    return {
      id: row.id,
      source: row.source,
      severity: row.severity,
      title: row.title,
      accountId: row.account_id,
      accountName: this.accounts.of(row.account_id),
      region: row.region,
      occurredAt: row.occurred_at.toISOString(),
      lastSeenAt: row.last_seen_at.toISOString(),
      status: row.status,
    };
  }
}
