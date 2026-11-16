import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantDatabase } from '../database/tenant-database';
import { normalizeEvent } from './alert-normalizer';
import { ReceivingProject } from './receiving-project';
import { SecurityAlertsIntake } from './security-alerts.intake';
import { SecurityAlertsStore } from './security-alerts.store';
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
    private readonly database: TenantDatabase,
    private readonly store: SecurityAlertsStore,
    private readonly intake: SecurityAlertsIntake,
    private readonly project: ReceivingProject,
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
    const tenantId = await this.project.id();
    if (!tenantId) {
      this.logger.warn(`Dropped ${from}: SECURITY_ALERTS_PROJECT does not name a project`);
      return 'not-set-up';
    }
    const alerts = normalizeEvent(text);
    if (!alerts) {
      this.logger.warn(`Dropped ${from}: the message is not an EventBridge event`);
      return 'rejected';
    }
    const result = await this.database.run(tenantId, async (trx) =>
      (await this.store.firstDelivery(trx, tenantId, messageId)) ? this.intake.save(trx, tenantId, alerts) : null,
    );
    if (!result) {
      this.logger.log(`Skipped ${from}: already handled`);
      return 'duplicate';
    }
    const keys = alerts.map(({ accountId, key }) => `${accountId}:${key}`).join(', ');
    this.logger.log(`Stored ${alerts.length} alert(s), ${result.created} new, from ${from}: ${keys}`);
    return 'handled';
  }
}
