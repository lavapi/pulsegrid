import type { MyNotificationsInput, NotificationSwitches } from '@pulsegrid/shared';
import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../database/tenant-context';

const DEFAULT_SWITCHES: NotificationSwitches = { prReady: true, prFailed: true, deployReady: true, deployFailed: true };

/** Someone who gets messages: their GitHub username, the email Slack knows them by, and what they want. */
export interface Watcher extends NotificationSwitches {
  githubLogin: string;
  email: string;
}

const switchesOf = (row: {
  pr_ready: boolean;
  pr_failed: boolean;
  deploy_ready: boolean;
  deploy_failed: boolean;
}): NotificationSwitches => ({
  prReady: row.pr_ready,
  prFailed: row.pr_failed,
  deployReady: row.deploy_ready,
  deployFailed: row.deploy_failed,
});

/** Each person's notification settings in a project. */
@Injectable()
export class NotificationSettings {
  async mine(trx: TenantTransaction, userId: string): Promise<MyNotificationsInput> {
    const row = await trx.selectFrom('notification_settings').selectAll().where('user_id', '=', userId).executeTakeFirst();
    return row ? { githubLogin: row.github_login, ...switchesOf(row) } : { githubLogin: null, ...DEFAULT_SWITCHES };
  }

  async save(trx: TenantTransaction, tenantId: string, userId: string, input: MyNotificationsInput): Promise<void> {
    const values = {
      github_login: input.githubLogin,
      pr_ready: input.prReady,
      pr_failed: input.prFailed,
      deploy_ready: input.deployReady,
      deploy_failed: input.deployFailed,
      updated_at: new Date(),
    };
    await trx
      .insertInto('notification_settings')
      .values({ tenant_id: tenantId, user_id: userId, ...values })
      .onConflict((conflict) => conflict.column('user_id').doUpdateSet(values))
      .execute();
  }

  /** Everyone with a GitHub username, by lowercase username. */
  async watchers(trx: TenantTransaction): Promise<Map<string, Watcher>> {
    const rows = await trx
      .selectFrom('notification_settings')
      .innerJoin('users', 'users.id', 'notification_settings.user_id')
      .selectAll('notification_settings')
      .select('users.email')
      .where('notification_settings.github_login', 'is not', null)
      .execute();
    return new Map(
      rows.flatMap((row) =>
        row.github_login
          ? [[row.github_login.toLowerCase(), { githubLogin: row.github_login, email: row.email, ...switchesOf(row) }]]
          : [],
      ),
    );
  }
}
