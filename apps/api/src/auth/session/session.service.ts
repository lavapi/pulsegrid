import { isUserPermission, USER_PERMISSIONS } from '@pulsegrid/shared';
import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { hashToken, newToken } from '../../common/secure-token';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/schema';
import { TenantDatabase } from '../../database/tenant-database';
import type { PersonContext, ProjectAccess } from './auth-context';

@Injectable()
export class SessionService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(accountId: string, tenantId: string | null): Promise<string> {
    const token = newToken();
    await this.db
      .insertInto('sessions')
      .values({
        account_id: accountId,
        tenant_id: tenantId,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + this.config.sessionTtlMs),
      })
      .execute();
    return token;
  }

  async resolve(token: string): Promise<PersonContext | null> {
    const row = await this.db
      .selectFrom('sessions')
      .innerJoin('accounts', 'accounts.id', 'sessions.account_id')
      .select([
        'sessions.id as sessionId',
        'sessions.tenant_id as tenantId',
        'accounts.id as accountId',
        'accounts.email as email',
        'accounts.display_name as displayName',
        'accounts.is_super_admin as isOwner',
        'accounts.totp_enabled_at as totpEnabledAt',
        'accounts.temporary_password_expires_at as temporaryPasswordUntil',
      ])
      .where('sessions.token_hash', '=', hashToken(token))
      .where('sessions.expires_at', '>', new Date())
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    const { tenantId, totpEnabledAt, temporaryPasswordUntil, ...person } = row;
    return {
      ...person,
      mustChangePassword: temporaryPasswordUntil !== null,
      twoFactorEnabled: totpEnabledAt !== null,
      project: tenantId ? await this.projectAccess(tenantId, person.accountId, person.isOwner) : null,
    };
  }

  async select(sessionId: string, tenantId: string | null): Promise<void> {
    await this.db.updateTable('sessions').set({ tenant_id: tenantId }).where('id', '=', sessionId).execute();
  }

  async leaveProject(accountId: string, tenantId: string): Promise<void> {
    await this.db
      .updateTable('sessions')
      .set({ tenant_id: null })
      .where('account_id', '=', accountId)
      .where('tenant_id', '=', tenantId)
      .execute();
  }

  async revoke(sessionId: string): Promise<void> {
    await this.db.deleteFrom('sessions').where('id', '=', sessionId).execute();
  }

  async revokeOthers(accountId: string, exceptSessionId?: string): Promise<void> {
    let query = this.db.deleteFrom('sessions').where('account_id', '=', accountId);
    if (exceptSessionId) {
      query = query.where('id', '!=', exceptSessionId);
    }
    await query.execute();
  }

  private projectAccess(tenantId: string, accountId: string, isOwner: boolean): Promise<ProjectAccess | null> {
    return this.database.run(tenantId, async (trx) => {
      const member = await trx
        .selectFrom('users')
        .innerJoin('roles', 'roles.id', 'users.role_id')
        .select([
          'users.id as userId',
          'roles.name as roleName',
          sql<string[]>`array(select permission from role_permissions where role_id = users.role_id)`.as('granted'),
        ])
        .where('users.account_id', '=', accountId)
        .executeTakeFirst();
      if (!member) {
        return null;
      }
      const { granted, ...access } = member;
      return {
        ...access,
        tenantId,
        permissions: new Set(isOwner ? USER_PERMISSIONS : granted.filter(isUserPermission)),
      };
    });
  }
}
