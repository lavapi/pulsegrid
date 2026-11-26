import { Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { TokenCipher } from '../inventory/connection/token-cipher';
import { createQueueConnection, queuePrefix } from '../redis/redis-connection';
import { NotificationSettings } from './notification-settings';
import { NOTIFICATIONS_QUEUE_NAME, NotificationsQueue } from './notifications.queue';
import { SentLog } from './sent-log';
import { SLACK_CLIENTS, SlackApps } from './slack-apps';
import { SlackClient } from './slack-client';

/** What the API and the worker share: the Slack app, people's settings, the sent log and the queue. */
@Module({
  providers: [
    { provide: SLACK_CLIENTS, useValue: (token: string) => new SlackClient(token) },
    {
      provide: TokenCipher,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new TokenCipher(config.tokenEncryptionKey),
    },
    {
      provide: NotificationsQueue,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new NotificationsQueue(
          new Queue(NOTIFICATIONS_QUEUE_NAME, {
            connection: createQueueConnection(config.redis),
            prefix: queuePrefix(config.redis),
          }),
        ),
    },
    NotificationSettings,
    SentLog,
    SlackApps,
  ],
  exports: [SLACK_CLIENTS, NotificationSettings, NotificationsQueue, SentLog, SlackApps],
})
export class NotificationsCoreModule implements OnApplicationShutdown {
  constructor(@Inject(NotificationsQueue) private readonly queue: NotificationsQueue) {}

  async onApplicationShutdown(): Promise<void> {
    await this.queue.close();
  }
}
