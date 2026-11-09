import {
  type AccountTagSummary,
  cloudProvider,
  type CloudAccount,
  type CredentialCheck,
  type TagFilter,
} from '@pulsegrid/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../../auth/session/auth-context';
import { isUniqueViolation } from '../../database/errors';
import type { CloudAccountRow } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import { isProductionName } from '../environments/environment-detection';
import {
  type CloudCredentials,
  type CloudProvider,
  CredentialsRejected,
} from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { SyncProgressStore } from '../sync/sync-progress.store';
import { SyncQueue } from '../sync/sync-queue';

export interface NewCloudAccount {
  provider: string;
  credentials: Record<string, string | undefined>;
  name: string;
  regions: string[];
  environmentId: string | null;
  tagFilter: TagFilter;
}

export interface CloudAccountSettings {
  name: string;
  regions: string[];
  tagFilter: TagFilter;
}

const NOT_FOUND = 'That cloud account is no longer connected.';
const NO_CREDENTIALS = 'Add credentials for this account before syncing it.';
const INVALID_CREDENTIALS = "Those credentials aren't in the right format.";
const INVALID_REGION = 'Choose valid regions for this provider.';
const ALREADY_ADDED = 'That account already has credentials. Replace them instead.';
const WRONG_ACCOUNT = 'Those credentials belong to a different account.';
const CHECK_FAILED = "We couldn't check those credentials. Please try again.";

const toCloudAccount = (row: CloudAccountRow, environmentName: string | null): CloudAccount => ({
  id: row.id,
  provider: row.provider,
  accountId: row.account_id,
  name: row.name,
  regions: row.regions,
  status: row.status,
  lastError: row.last_error,
  lastSyncedAt: row.last_synced_at?.toISOString() ?? null,
  syncIssues: row.sync_issues,
  environmentId: row.environment_id,
  environmentName,
  isProduction: environmentName !== null && isProductionName(environmentName),
  hasCredentials: row.encrypted_credentials !== null,
  credentialHint: row.credential_hint,
  canWrite: row.can_write,
  tagFilter: row.tag_filter,
});

const parsed = (provider: CloudProvider, input: unknown): CloudCredentials => {
  const credentials = provider.parseCredentials(input);
  if (!credentials) {
    throw new BadRequestException(INVALID_CREDENTIALS);
  }
  return credentials;
};

@Injectable()
export class CloudAccountsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
    private readonly queue: SyncQueue,
    private readonly progress: SyncProgressStore,
    private readonly vault: CredentialVault,
    private readonly providers: ProviderRegistry,
  ) {}

  list(tenantId: string): Promise<CloudAccount[]> {
    return this.database.run(tenantId, async (trx) => {
      const rows = await trx
        .selectFrom('cloud_accounts')
        .leftJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
        .selectAll('cloud_accounts')
        .select('environments.name as environment_name')
        .orderBy('cloud_accounts.name')
        .execute();
      return rows.map((row) => toCloudAccount(row, row.environment_name));
    });
  }

  checkCredentials(providerId: string, input: unknown): Promise<CredentialCheck> {
    const provider = this.providers.get(providerId);
    const region = cloudProvider(providerId)?.defaultRegion ?? '';
    return this.check(provider, parsed(provider, input), region);
  }

  async add(auth: AuthContext, input: NewCloudAccount, ip: string | undefined): Promise<CloudAccount> {
    const { name, regions, environmentId, tagFilter } = input;
    const provider = this.providers.get(input.provider);
    if (!regions.every(provider.isValidRegion)) {
      throw new BadRequestException(INVALID_REGION);
    }
    const credentials = parsed(provider, input.credentials);
    const check = await this.check(provider, credentials, regions[0] ?? '');
    const identity = {
      tenant_id: auth.tenantId,
      provider: provider.id,
      account_id: check.accountId,
    };
    const secured = this.secured(provider, identity, credentials, check);

    try {
      const row = await this.database.run(auth.tenantId, async (trx) => {
        const existing = await trx
          .selectFrom('cloud_accounts')
          .select('encrypted_credentials')
          .where('provider', '=', provider.id)
          .where('account_id', '=', check.accountId)
          .executeTakeFirst();
        if (existing?.encrypted_credentials) {
          throw new ConflictException(ALREADY_ADDED);
        }
        const values = {
          name,
          regions,
          environment_id: environmentId,
          environment_reviewed: true,
          tag_filter: JSON.stringify(tagFilter),
          status: 'connected' as const,
          last_error: null,
          ...secured,
        };
        const saved = await trx
          .insertInto('cloud_accounts')
          .values({ ...identity, ...values })
          .onConflict((conflict) =>
            conflict.columns(['tenant_id', 'provider', 'account_id']).doUpdateSet(values),
          )
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.record(trx, auth, 'cloud.account.added', saved, ip);
        return saved;
      });
      await this.startSync(auth.tenantId, row.id);
      return await this.present(auth.tenantId, row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(ALREADY_ADDED);
      }
      throw error;
    }
  }

  async replaceCredentials(
    auth: AuthContext,
    id: string,
    input: unknown,
    ip: string | undefined,
  ): Promise<CloudAccount> {
    const current = await this.database.run(auth.tenantId, (trx) => this.find(trx, id));
    const provider = this.providers.get(current.provider);
    const credentials = parsed(provider, input);
    const check = await this.check(provider, credentials, current.regions[0] ?? '');
    if (check.accountId !== current.account_id) {
      throw new BadRequestException(WRONG_ACCOUNT);
    }
    const row = await this.database.run(auth.tenantId, async (trx) => {
      const saved = await trx
        .updateTable('cloud_accounts')
        .set({
          ...this.secured(provider, current, credentials, check),
          status: 'connected',
          last_error: null,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.record(trx, auth, 'cloud.account.credentials_replaced', saved, ip);
      return saved;
    });
    await this.startSync(auth.tenantId, id);
    return this.present(auth.tenantId, row);
  }

  async update(
    auth: AuthContext,
    id: string,
    { name, regions, tagFilter }: CloudAccountSettings,
    ip: string | undefined,
  ): Promise<CloudAccount> {
    const row = await this.database.run(auth.tenantId, async (trx) => {
      const current = await this.find(trx, id);
      const provider = this.providers.get(current.provider);
      if (!regions.every(provider.isValidRegion)) {
        throw new BadRequestException(INVALID_REGION);
      }
      const saved = await trx
        .updateTable('cloud_accounts')
        .set({ name, regions, tag_filter: JSON.stringify(tagFilter) })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const regional = provider.collectors.flatMap(({ scope, types }) =>
        scope === 'regional' ? [...types] : [],
      );
      await trx
        .deleteFrom('resources')
        .where('cloud_account_id', '=', id)
        .where('type', 'in', regional)
        .where('region', 'not in', regions)
        .execute();
      await this.record(trx, auth, 'cloud.account.updated', saved, ip);
      return saved;
    });
    await this.startSync(auth.tenantId, id);
    return this.present(auth.tenantId, row);
  }

  async tagSummary(auth: AuthContext, id: string): Promise<AccountTagSummary> {
    return this.database.run(auth.tenantId, async (trx) => {
      const account = await this.find(trx, id);
      const { unfilteredTypes } = this.providers.get(account.provider);
      const rows = await trx
        .selectFrom('resources')
        .select(['tags', 'type'])
        .where('cloud_account_id', '=', id)
        .execute();
      return {
        tagSets: rows.filter(({ type }) => !unfilteredTypes.includes(type)).map(({ tags }) => tags),
      };
    });
  }

  async testConnection(auth: AuthContext, id: string): Promise<CloudAccount> {
    const row = await this.database.run(auth.tenantId, (trx) => this.find(trx, id));
    const credentials = this.vault.open(row);
    if (!credentials) {
      throw new ConflictException(NO_CREDENTIALS);
    }
    const failure = await this.failureOf(row, credentials);
    const saved = await this.database.run(auth.tenantId, (trx) =>
      trx
        .updateTable('cloud_accounts')
        .set({ status: failure ? 'error' : 'connected', last_error: failure })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    return this.present(auth.tenantId, saved);
  }

  remove(auth: AuthContext, id: string, ip: string | undefined): Promise<void> {
    return this.database.run(auth.tenantId, async (trx) => {
      const row = await this.find(trx, id);
      await trx.deleteFrom('cloud_accounts').where('id', '=', id).execute();
      await this.record(trx, auth, 'cloud.account.removed', row, ip);
    });
  }

  async requestSync(auth: AuthContext, id: string, ip: string | undefined): Promise<void> {
    await this.database.run(auth.tenantId, async (trx) => {
      const row = await this.find(trx, id);
      if (row.status !== 'connected' || !row.encrypted_credentials) {
        throw new ConflictException(NO_CREDENTIALS);
      }
      await this.record(trx, auth, 'cloud.account.sync_requested', row, ip);
    });
    await this.startSync(auth.tenantId, id);
  }

  private present(tenantId: string, row: CloudAccountRow): Promise<CloudAccount> {
    return this.database.run(tenantId, async (trx) => {
      const environment =
        row.environment_id === null
          ? undefined
          : await trx
              .selectFrom('environments')
              .select('name')
              .where('id', '=', row.environment_id)
              .executeTakeFirst();
      return toCloudAccount(row, environment?.name ?? null);
    });
  }

  private async check(
    provider: CloudProvider,
    credentials: CloudCredentials,
    region: string,
  ): Promise<CredentialCheck> {
    try {
      return await provider.checkCredentials(credentials, region);
    } catch (error) {
      throw new BadRequestException(
        error instanceof CredentialsRejected ? error.message : CHECK_FAILED,
      );
    }
  }

  private async startSync(tenantId: string, accountId: string): Promise<void> {
    await this.progress.watch({ tenantId, accountId });
    await this.queue.enqueue({ tenantId, accountId });
  }

  private secured(
    provider: CloudProvider,
    identity: Pick<CloudAccountRow, 'tenant_id' | 'provider' | 'account_id'>,
    credentials: CloudCredentials,
    check: CredentialCheck,
  ) {
    return {
      encrypted_credentials: this.vault.seal(identity, credentials),
      credential_hint: provider.credentialHint(credentials),
      can_write: check.canWrite,
    };
  }

  private async failureOf(
    row: CloudAccountRow,
    credentials: CloudCredentials,
  ): Promise<string | null> {
    const provider = this.providers.get(row.provider);
    try {
      const { accountId } = await this.check(provider, credentials, row.regions[0] ?? '');
      return accountId === row.account_id ? null : WRONG_ACCOUNT;
    } catch (error) {
      return (error as Error).message;
    }
  }

  private async find(trx: TenantTransaction, id: string): Promise<CloudAccountRow> {
    const row = await trx
      .selectFrom('cloud_accounts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException(NOT_FOUND);
    }
    return row;
  }

  private record(
    trx: TenantTransaction,
    auth: AuthContext,
    action: string,
    row: CloudAccountRow,
    ipAddress: string | undefined,
  ): Promise<void> {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'cloud_account', id: row.id },
      ipAddress,
      metadata: {
        label: row.name,
        provider: row.provider,
        accountId: row.account_id,
        credential: row.credential_hint,
      },
    });
  }
}
