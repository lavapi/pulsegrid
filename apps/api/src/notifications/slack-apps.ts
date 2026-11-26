import type { SlackApp } from '@pulsegrid/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { TenantTransaction } from '../database/tenant-context';
import { TokenCipher } from '../inventory/connection/token-cipher';
import type { SlackClient } from './slack-client';

export type SlackClients = (token: string) => SlackClient;
export const SLACK_CLIENTS = Symbol('SLACK_CLIENTS');

const contextFor = (tenantId: string): string => `slack-app:${tenantId}`;

/** The Slack app each project sends personal messages through; its bot token is stored encrypted, never shown. */
@Injectable()
export class SlackApps {
  constructor(
    private readonly cipher: TokenCipher,
    @Inject(SLACK_CLIENTS) private readonly clients: SlackClients,
  ) {}

  async view(trx: TenantTransaction): Promise<SlackApp> {
    const row = await trx
      .selectFrom('slack_apps')
      .select(['workspace', 'updated_by_email', 'updated_at'])
      .executeTakeFirst();
    return {
      connected: Boolean(row),
      workspace: row?.workspace ?? null,
      updatedBy: row?.updated_by_email ?? null,
      updatedAt: row?.updated_at.toISOString() ?? null,
    };
  }

  /** Checks the token with Slack, then keeps it; a token Slack refuses throws its readable message. */
  async connect(trx: TenantTransaction, tenantId: string, token: string, email: string): Promise<void> {
    const workspace = await this.clients(token).workspace();
    const values = {
      encrypted_token: this.cipher.encrypt(token, contextFor(tenantId)),
      workspace,
      updated_by_email: email,
      updated_at: new Date(),
    };
    await trx
      .insertInto('slack_apps')
      .values({ tenant_id: tenantId, ...values })
      .onConflict((conflict) => conflict.column('tenant_id').doUpdateSet(values))
      .execute();
  }

  async remove(trx: TenantTransaction): Promise<boolean> {
    const result = await trx.deleteFrom('slack_apps').executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async client(trx: TenantTransaction, tenantId: string): Promise<SlackClient | null> {
    const row = await trx.selectFrom('slack_apps').select('encrypted_token').executeTakeFirst();
    return row ? this.clients(this.cipher.decrypt<string>(row.encrypted_token, contextFor(tenantId))) : null;
  }
}
