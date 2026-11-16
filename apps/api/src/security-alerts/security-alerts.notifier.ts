import { ALERT_SOURCE_LABELS } from '@pulsegrid/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { TenantDatabase } from '../database/tenant-database';
import { AccountNames } from './account-names';
import type { NotifyJob } from './security-alerts.queue';
import { SecurityAlertsStore } from './security-alerts.store';
import { SlackIntegrations } from './slack-integrations';
import { SlackPoster } from './slack-poster';

const slackText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Tells the project's Slack about a new alert; projects without Slack see it on the alerts page only. */
@Injectable()
export class SecurityAlertsNotifier {
  private readonly logger = new Logger(SecurityAlertsNotifier.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly store: SecurityAlertsStore,
    private readonly slack: SlackIntegrations,
    private readonly poster: SlackPoster,
    private readonly accounts: AccountNames,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async notify({ tenantId, alertId }: NotifyJob): Promise<void> {
    const found = await this.database.run(tenantId, async (trx) => ({
      alert: await this.store.find(trx, alertId),
      webhookUrl: await this.slack.webhookUrl(trx, tenantId),
    }));
    if (!found.alert || !found.webhookUrl) {
      return;
    }
    const { alert } = found;
    const link = new URL(`/security-alerts/${alert.id}`, this.config.publicUrl).toString();
    const where = [this.accounts.label(alert.account_id), alert.region].filter(Boolean).join(', ');
    const text = [
      `:rotating_light: *${alert.severity}* ${ALERT_SOURCE_LABELS[alert.source]} alert in ${slackText(where)}`,
      slackText(alert.title),
      `<${link}|Open in PulseGrid>`,
    ].join('\n');
    await this.poster.send(found.webhookUrl, text);
    this.logger.log(`Sent Slack notification for alert ${alert.id} (${alert.alert_key})`);
  }
}
