import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { TokenCipher } from '../inventory/connection/token-cipher';
import { createQueueConnection, queuePrefix } from '../redis/redis-connection';
import { AccountNames } from './account-names';
import { SECURITY_ALERTS_QUEUE_NAME, SecurityAlertsQueue } from './security-alerts.queue';
import {
  loadSecurityAlertsSettings,
  SECURITY_ALERTS_SETTINGS,
  type SecurityAlertsSettings,
} from './security-alerts.settings';
import { ReceivingProject } from './receiving-project';
import { SecurityAlertsIntake } from './security-alerts.intake';
import { SecurityAlertsStore } from './security-alerts.store';
import { SECURITY_HUB_CLIENTS, SecurityHubReader, securityHubClients } from './security-hub-reader';
import { SlackIntegrations } from './slack-integrations';
import { POST_TO_SLACK, postJson, SlackPoster } from './slack-poster';

/** What the API and the worker share: the settings, the alerts, Slack, Security Hub and the queue. */
@Module({
  providers: [
    { provide: SECURITY_ALERTS_SETTINGS, useFactory: () => loadSecurityAlertsSettings(process.env) },
    {
      provide: SecurityAlertsQueue,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new SecurityAlertsQueue(
          new Queue(SECURITY_ALERTS_QUEUE_NAME, {
            connection: createQueueConnection(config.redis),
            prefix: queuePrefix(config.redis),
          }),
        ),
    },
    {
      provide: TokenCipher,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new TokenCipher(config.tokenEncryptionKey),
    },
    { provide: POST_TO_SLACK, useValue: postJson },
    {
      provide: SECURITY_HUB_CLIENTS,
      inject: [SECURITY_ALERTS_SETTINGS],
      useFactory: (settings: SecurityAlertsSettings) => securityHubClients(settings),
    },
    AccountNames,
    ReceivingProject,
    SecurityAlertsIntake,
    SecurityAlertsStore,
    SecurityHubReader,
    SlackIntegrations,
    SlackPoster,
  ],
  exports: [
    SECURITY_ALERTS_SETTINGS,
    SecurityAlertsQueue,
    AccountNames,
    ReceivingProject,
    SecurityAlertsIntake,
    SecurityAlertsStore,
    SecurityHubReader,
    SlackIntegrations,
    SlackPoster,
  ],
})
export class SecurityAlertsCoreModule implements OnApplicationShutdown {
  constructor(@Inject(SecurityAlertsQueue) private readonly queue: SecurityAlertsQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
