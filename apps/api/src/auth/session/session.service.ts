import { DEVICE_SESSION_DAYS, isUserPermission, type SignedInDevice, USER_PERMISSIONS } from '@pulsegrid/shared';
import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { hashToken, newToken } from '../../common/secure-token';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/schema';
import { TenantDatabase } from '../../database/tenant-database';
import type { PersonContext, ProjectAccess } from './auth-context';

const DEVICE_TTL_MS = DEVICE_SESSION_DAYS * 24 * 60 * 60 * 1000;
/** How often a phone's use is written down, extending its sign-in; more often would write on every request. */
const TOUCH_EVERY_MS = 60 * 60 * 1000;

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

  /** A sign-in for the iPhone app, lasting while the phone keeps using it. */
  async createForDevice(accountId: string, tenantId: string | null, deviceName: string): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + DEVICE_TTL_MS);
    await this.db
      .insertInto('sessions')
      .values({
        account_id: accountId,
        tenant_id: tenantId,
        token_hash: hashToken(token),
        expires_at: expiresAt,
        client: 'ios',
        device_name: deviceName,
        last_used_at: new Date(),
      })
      .execute();
    return { token, expiresAt };
  }

  async devices(accountId: string, currentSessionId: string): Promise<SignedInDevice[]> {
    const rows = await this.db
      .selectFrom('sessions')
      .select(['id', 'device_name', 'created_at', 'last_used_at'])
      .where('account_id', '=', accountId)
      .where('client', '=', 'ios')
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      name: row.device_name ?? 'iPhone',
      signedInAt: row.created_at.toISOString(),
      lastUsedAt: row.last_used_at?.toISOString() ?? null,
      current: row.id === currentSessionId,
    }));
  }

  /** Signs out one of the person's own phones; false when it isn't theirs or is already gone. */
  async revokeDevice(accountId: string, sessionId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('sessions')
      .where('id', '=', sessionId)
      .where('account_id', '=', accountId)
      .where('client', '=', 'ios')
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
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
        'sessions.client as client',
        'sessions.last_used_at as lastUsedAt',
      ])
      .where('sessions.token_hash', '=', hashToken(token))
      .where('sessions.expires_at', '>', new Date())
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    const { tenantId, totpEnabledAt, temporaryPasswordUntil, lastUsedAt, ...person } = row;
    if (person.client === 'ios') {
      await this.touchDevice(person.sessionId, lastUsedAt);
    }
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

  private async touchDevice(sessionId: string, lastUsedAt: Date | null): Promise<void> {
    const now = Date.now();
    if (lastUsedAt && now - lastUsedAt.getTime() < TOUCH_EVERY_MS) {
      return;
    }
    await this.db
      .updateTable('sessions')
      .set({ last_used_at: new Date(now), expires_at: new Date(now + DEVICE_TTL_MS) })
      .where('id', '=', sessionId)
      .execute();
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
