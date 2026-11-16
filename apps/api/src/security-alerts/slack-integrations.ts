import type { SlackIntegration } from '@pulsegrid/shared';
import { Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../database/tenant-context';
import { TokenCipher } from '../inventory/connection/token-cipher';

export const SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/;

const contextFor = (tenantId: string): string => `slack-webhook:${tenantId}`;

/** The Slack incoming webhook each project posts to, stored encrypted and never shown again. */
@Injectable()
export class SlackIntegrations {
  constructor(private readonly cipher: TokenCipher) {}

  async view(trx: TenantTransaction): Promise<SlackIntegration> {
    const row = await trx
      .selectFrom('slack_integrations')
      .select(['updated_by_email', 'updated_at'])
      .executeTakeFirst();
    return {
      connected: Boolean(row),
      updatedBy: row?.updated_by_email ?? null,
      updatedAt: row?.updated_at.toISOString() ?? null,
    };
  }

  async save(trx: TenantTransaction, tenantId: string, webhookUrl: string, email: string): Promise<void> {
    const values = {
      encrypted_webhook_url: this.cipher.encrypt(webhookUrl, contextFor(tenantId)),
      updated_by_email: email,
      updated_at: new Date(),
    };
    await trx
      .insertInto('slack_integrations')
      .values({ tenant_id: tenantId, ...values })
      .onConflict((conflict) => conflict.column('tenant_id').doUpdateSet(values))
      .execute();
  }

  async remove(trx: TenantTransaction): Promise<void> {
    await trx.deleteFrom('slack_integrations').execute();
  }

  async webhookUrl(trx: TenantTransaction, tenantId: string): Promise<string | null> {
    const row = await trx.selectFrom('slack_integrations').select('encrypted_webhook_url').executeTakeFirst();
    return row ? this.cipher.decrypt<string>(row.encrypted_webhook_url, contextFor(tenantId)) : null;
  }
}
