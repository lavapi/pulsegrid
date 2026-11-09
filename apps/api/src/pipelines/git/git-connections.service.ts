import type { GitAccessCheck, GitConnection } from '@pulsegrid/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../../auth/session/auth-context';
import { isUniqueViolation } from '../../database/errors';
import type { GitConnectionRow } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../../inventory/connection/credential-vault';
import { type GitClient, type GitCredentials, type GitProvider, GitProviderError } from './git-provider';
import { GitProviderRegistry } from './git-provider-registry';

export interface NewGitConnection {
  provider: string;
  name: string;
  organization: string;
  credentials: Record<string, string | undefined>;
}

const NOT_FOUND = 'That Git connection no longer exists.';
const INVALID_CREDENTIALS = "Those credentials aren't in the right format.";
const CHECK_FAILED = "We couldn't check those credentials. Please try again.";
const ALREADY_ADDED = 'That organization is already connected. Replace its credentials instead.';

const toConnection = (row: GitConnectionRow): GitConnection => ({
  id: row.id,
  provider: row.provider,
  name: row.name,
  organization: row.organization,
  credentialHint: row.credential_hint,
  status: row.status,
  lastError: row.last_error,
});

const sealTarget = ({ tenant_id, provider, organization, encrypted_credentials }: GitConnectionRow) => ({
  tenant_id,
  provider,
  account_id: organization,
  encrypted_credentials,
});

const parsed = (provider: GitProvider, input: unknown): GitCredentials => {
  const credentials = provider.parseCredentials(input);
  if (!credentials) {
    throw new BadRequestException(INVALID_CREDENTIALS);
  }
  return credentials;
};

@Injectable()
export class GitConnectionsService {
  private readonly logger = new Logger(GitConnectionsService.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
    private readonly vault: CredentialVault,
    private readonly providers: GitProviderRegistry,
  ) {}

  list(tenantId: string): Promise<GitConnection[]> {
    return this.database.run(tenantId, async (trx) => {
      const rows = await trx.selectFrom('git_connections').selectAll().orderBy('name').execute();
      return rows.map(toConnection);
    });
  }

  checkCredentials(providerId: string, organization: string, input: unknown): Promise<GitAccessCheck> {
    const provider = this.providers.get(providerId);
    return this.check(provider, parsed(provider, input), organization);
  }

  async add(auth: AuthContext, input: NewGitConnection, ip: string | undefined): Promise<GitConnection> {
    const { name, organization } = input;
    const provider = this.providers.get(input.provider);
    const credentials = parsed(provider, input.credentials);
    await this.check(provider, credentials, organization);
    try {
      return await this.database.run(auth.tenantId, async (trx) => {
        const row = await trx
          .insertInto('git_connections')
          .values({
            tenant_id: auth.tenantId,
            provider: provider.id,
            name,
            organization,
            encrypted_credentials: this.vault.seal(
              { tenant_id: auth.tenantId, provider: provider.id, account_id: organization },
              credentials,
            ),
            credential_hint: provider.credentialHint(credentials),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx
          .updateTable('pipeline_apps')
          .set({ connection_id: row.id })
          .where('connection_id', 'is', null)
          .where(sql<boolean>`lower(split_part(repository, '/', 1)) = lower(${organization})`)
          .execute();
        await this.record(trx, auth, 'git.connection.added', row, ip);
        return toConnection(row);
      });
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
  ): Promise<GitConnection> {
    const current = await this.find(auth.tenantId, id);
    const provider = this.providers.get(current.provider);
    const credentials = parsed(provider, input);
    await this.check(provider, credentials, current.organization);
    return this.database.run(auth.tenantId, async (trx) => {
      const row = await trx
        .updateTable('git_connections')
        .set({
          encrypted_credentials: this.vault.seal(
            { tenant_id: auth.tenantId, provider: provider.id, account_id: current.organization },
            credentials,
          ),
          credential_hint: provider.credentialHint(credentials),
          status: 'connected',
          last_error: null,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.record(trx, auth, 'git.connection.credentials_replaced', row, ip);
      return toConnection(row);
    });
  }

  async testConnection(auth: AuthContext, id: string): Promise<GitConnection> {
    const row = await this.find(auth.tenantId, id);
    const failure = await this.failureOf(row);
    const saved = await this.database.run(auth.tenantId, (trx) =>
      trx
        .updateTable('git_connections')
        .set({ status: failure ? 'error' : 'connected', last_error: failure })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
    return toConnection(saved);
  }

  remove(auth: AuthContext, id: string, ip: string | undefined): Promise<void> {
    return this.database.run(auth.tenantId, async (trx) => {
      const row = await trx
        .deleteFrom('git_connections')
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (!row) {
        throw new NotFoundException(NOT_FOUND);
      }
      await this.record(trx, auth, 'git.connection.removed', row, ip);
    });
  }

  async clientFor(tenantId: string, id: string): Promise<GitClient | null> {
    const row = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('git_connections').selectAll().where('id', '=', id).executeTakeFirst(),
    );
    if (!row) {
      return null;
    }
    try {
      return this.clientOf(row);
    } catch {
      this.logger.warn(`Git connection ${id} could not be opened.`);
      return null;
    }
  }

  private clientOf(row: GitConnectionRow): GitClient {
    const credentials = this.vault.open(sealTarget(row)) ?? {};
    return this.providers.get(row.provider).connect(credentials);
  }

  private async check(
    provider: GitProvider,
    credentials: GitCredentials,
    organization: string,
  ): Promise<GitAccessCheck> {
    try {
      return await provider.connect(credentials).checkAccess(organization);
    } catch (error) {
      throw new BadRequestException(
        error instanceof GitProviderError ? error.userMessage : CHECK_FAILED,
      );
    }
  }

  private async failureOf(row: GitConnectionRow): Promise<string | null> {
    try {
      await this.clientOf(row).checkAccess(row.organization);
      return null;
    } catch (error) {
      return error instanceof GitProviderError ? error.userMessage : CHECK_FAILED;
    }
  }

  private async find(tenantId: string, id: string): Promise<GitConnectionRow> {
    const row = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('git_connections').selectAll().where('id', '=', id).executeTakeFirst(),
    );
    if (!row) {
      throw new NotFoundException(NOT_FOUND);
    }
    return row;
  }

  private record(
    trx: TenantTransaction,
    auth: AuthContext,
    action: string,
    row: GitConnectionRow,
    ipAddress: string | undefined,
  ): Promise<void> {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'git_connection', id: row.id },
      ipAddress,
      metadata: {
        label: row.name,
        provider: row.provider,
        organization: row.organization,
        credential: row.credential_hint,
      },
    });
  }
}
