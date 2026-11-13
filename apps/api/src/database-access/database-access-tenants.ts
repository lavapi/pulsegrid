import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { CredentialVault } from '../inventory/connection/credential-vault';
import { parseAwsKey } from '../inventory/providers/aws/aws-key';
import { DatabaseAccessError, MESSAGES } from './database-access-errors';
import { DatabaseAccessWorkflows, DEFAULT_POLL, type PollOptions } from './database-access-workflows';
import { DATABASE_ACCESS_SETUP, type DatabaseAccessSetup } from './database-access.settings';

export const WORKFLOW_POLL = Symbol('WORKFLOW_POLL');

/**
 * Database access belongs to the projects that have the Production account connected, and runs with that
 * account's stored key.
 */
@Injectable()
export class DatabaseAccessTenants {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly vault: CredentialVault,
    @Inject(DATABASE_ACCESS_SETUP) private readonly setup: DatabaseAccessSetup,
    @Inject(WORKFLOW_POLL) private readonly poll: PollOptions = DEFAULT_POLL,
  ) {}

  async owns(tenantId: string): Promise<boolean> {
    return Boolean(await this.productionAccount(tenantId));
  }

  async all(): Promise<string[]> {
    const tenants = await this.db.selectFrom('tenants').select('id').execute();
    const owning: string[] = [];
    for (const { id } of tenants) {
      if (await this.owns(id)) {
        owning.push(id);
      }
    }
    return owning;
  }

  /** The workflows, called with the Production account's key in this project. */
  async workflows(tenantId: string): Promise<DatabaseAccessWorkflows> {
    const account = await this.productionAccount(tenantId);
    const key = account ? parseAwsKey(this.vault.open(account)) : null;
    if (!this.setup.ready || !key) {
      throw new DatabaseAccessError(MESSAGES.noKey);
    }
    return new DatabaseAccessWorkflows(this.setup.settings, key, this.poll);
  }

  private async productionAccount(tenantId: string) {
    if (!this.setup.ready) {
      return undefined;
    }
    const { accountId } = this.setup.settings;
    return this.database.run(tenantId, (trx) =>
      trx
        .selectFrom('cloud_accounts')
        .select(['id', 'tenant_id', 'provider', 'account_id', 'encrypted_credentials'])
        .where('account_id', '=', accountId)
        .where('provider', '=', 'aws')
        .executeTakeFirst(),
    );
  }
}
