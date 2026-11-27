import type { PushMessage, PushSender } from '@pulsegrid/push';
import type { NotificationTopic, UserPermission } from '@pulsegrid/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'kysely';
import { TenantDatabase } from '../database/tenant-database';
import { NotificationSettingsStore } from './notification-settings.store';
import { PushDevicesStore } from './push-devices.store';

export const PUSH_SENDER = Symbol('PUSH_SENDER');

/**
 * Push notifications to people's iPhones. Sending never holds up or fails the action that caused it: it runs on
 * its own, and failures are only logged. Each person gets only the topics they left on (NotificationSettingsStore).
 * It sends through Apple or the push relay (see pushSenderFor).
 */
@Injectable()
export class PushNotifier {
  private readonly logger = new Logger(PushNotifier.name);

  constructor(
    @Inject(PUSH_SENDER) private readonly sender: PushSender | null,
    private readonly devices: PushDevicesStore,
    private readonly database: TenantDatabase,
    private readonly settings: NotificationSettingsStore,
  ) {}

  /** Everyone in the project who holds the permission; the super admin holds them all. */
  toPermission(tenantId: string, permission: UserPermission, topic: NotificationTopic, message: PushMessage): void {
    this.inBackground(async () => {
      const rows = await this.database.run(tenantId, (trx) =>
        trx
          .selectFrom('users')
          .innerJoin('accounts', 'accounts.id', 'users.account_id')
          .select('users.account_id')
          .where((where) =>
            where.or([
              where('accounts.is_super_admin', '=', true),
              sql<boolean>`exists (select 1 from role_permissions where role_id = users.role_id and permission = ${permission})`,
            ]),
          )
          .execute(),
      );
      await this.send(rows.map(({ account_id }) => account_id), topic, message);
    });
  }

  /** Everyone in the project. */
  toProject(tenantId: string, topic: NotificationTopic, message: PushMessage): void {
    this.inBackground(async () => {
      const rows = await this.database.run(tenantId, (trx) => trx.selectFrom('users').select('account_id').execute());
      await this.send(rows.map(({ account_id }) => account_id), topic, message);
    });
  }

  toUser(tenantId: string, userId: string, topic: NotificationTopic, message: PushMessage): void {
    this.inBackground(async () => {
      const row = await this.database.run(tenantId, (trx) =>
        trx.selectFrom('users').select('account_id').where('id', '=', userId).executeTakeFirst(),
      );
      await this.send(row ? [row.account_id] : [], topic, message);
    });
  }

  /** To the phones of the accounts that want this topic. */
  private async send(accountIds: readonly string[], topic: NotificationTopic, message: PushMessage): Promise<void> {
    if (!this.sender) return;
    const wanting = await this.settings.allowing(accountIds, topic);
    for (const device of await this.devices.forAccounts(wanting)) {
      const result = await this.sender.send(device.apnsToken, device.environment, message);
      if (result === 'gone') await this.devices.forget(device.id);
      if (result === 'failed') this.logger.warn(`A push notification wasn't delivered: ${message.collapseId}`);
    }
  }

  private inBackground(work: () => Promise<void>): void {
    void work().catch((error: unknown) =>
      this.logger.warn(`Sending push notifications failed: ${error instanceof Error ? error.name : 'unknown error'}`),
    );
  }
}
