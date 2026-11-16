import { NOTIFYING_SEVERITIES } from '@pulsegrid/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { type NormalizedAlert, normalizeEvent } from './alert-normalizer';
import { SECURITY_ALERTS_SETTINGS, type SecurityAlertsSettings } from './security-alerts.settings';
import { SecurityAlertsQueue } from './security-alerts.queue';
import { type CreatedAlert, SecurityAlertsStore } from './security-alerts.store';
import type { SnsMessage } from './sns-message';
import { isSnsUrl } from './sns-signature';

const CONFIRM_TIMEOUT_MS = 5_000;

export type ConfirmSubscription = (url: string) => Promise<void>;

export const CONFIRM_SUBSCRIPTION = Symbol('CONFIRM_SUBSCRIPTION');

export const visitSubscribeUrl: ConfirmSubscription = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS), redirect: 'error' });
  if (!response.ok) {
    throw new Error(`SNS answered ${response.status}`);
  }
};

export type InboxResult = 'handled' | 'duplicate' | 'not-set-up' | 'rejected';

/** What happens to a verified SNS message: confirmations are answered, notifications become alerts. */
@Injectable()
export class SecurityAlertsInbox {
  private readonly logger = new Logger(SecurityAlertsInbox.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly store: SecurityAlertsStore,
    private readonly queue: SecurityAlertsQueue,
    @Inject(SECURITY_ALERTS_SETTINGS) private readonly settings: SecurityAlertsSettings,
    @Inject(CONFIRM_SUBSCRIPTION) private readonly confirm: ConfirmSubscription,
  ) {}

  async receive(message: SnsMessage): Promise<InboxResult> {
    const from = `${message.MessageId} on ${message.TopicArn}`;
    switch (message.Type) {
      case 'SubscriptionConfirmation':
        return this.confirmSubscription(message.SubscribeURL, from);
      case 'UnsubscribeConfirmation':
        this.logger.warn(`Unsubscribed from ${message.TopicArn} (${message.MessageId})`);
        return 'handled';
      case 'Notification':
        return this.storeAlerts(message.MessageId, message.Message, from);
    }
  }

  private async confirmSubscription(subscribeUrl: string, from: string): Promise<InboxResult> {
    if (!isSnsUrl(subscribeUrl)) {
      this.logger.warn(`Refused subscription ${from}: the confirmation link is not on an SNS host`);
      return 'rejected';
    }
    await this.confirm(subscribeUrl);
    this.logger.log(`Confirmed subscription ${from}`);
    return 'handled';
  }

  private async storeAlerts(messageId: string, text: string, from: string): Promise<InboxResult> {
    const tenantId = await this.tenantId();
    if (!tenantId) {
      this.logger.warn(`Dropped ${from}: SECURITY_ALERTS_PROJECT does not name a project`);
      return 'not-set-up';
    }
    const alerts = normalizeEvent(text);
    if (!alerts) {
      this.logger.warn(`Dropped ${from}: the message is not an EventBridge event`);
      return 'rejected';
    }
    const created = await this.database.run(tenantId, async (trx) => {
      if (!(await this.store.firstDelivery(trx, tenantId, messageId))) {
        return null;
      }
      const stored: CreatedAlert[] = [];
      for (const alert of alerts) {
        const row = await this.store.upsert(trx, tenantId, alert);
        if (row) stored.push(row);
      }
      await this.queueNotifications(tenantId, stored);
      return stored;
    });
    if (!created) {
      this.logger.log(`Skipped ${from}: already handled`);
      return 'duplicate';
    }
    this.logReceived(from, alerts, created.length);
    return 'handled';
  }

  /** Queued before the alerts are committed, so a failure here leaves SNS to retry the whole message. */
  private async queueNotifications(tenantId: string, created: CreatedAlert[]): Promise<void> {
    for (const alert of created.filter(({ severity }) => NOTIFYING_SEVERITIES.includes(severity))) {
      await this.queue.notify({ tenantId, alertId: alert.id });
    }
  }

  private logReceived(from: string, alerts: NormalizedAlert[], createdCount: number): void {
    const keys = alerts.map(({ accountId, key }) => `${accountId}:${key}`).join(', ');
    this.logger.log(`Stored ${alerts.length} alert(s), ${createdCount} new, from ${from}: ${keys}`);
  }

  private async tenantId(): Promise<string | null> {
    if (!this.settings.projectSlug) {
      return null;
    }
    const tenant = await this.db
      .selectFrom('tenants')
      .select('id')
      .where('slug', '=', this.settings.projectSlug)
      .executeTakeFirst();
    return tenant?.id ?? null;
  }
}
