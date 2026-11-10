import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { RedisClient } from '../redis/redis-connection';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { hashToken, newToken } from '../common/secure-token';
import { DATABASE } from '../database/database.module';
import type { Account, Database } from '../database/schema';
import type { TenantTransaction } from '../database/tenant-context';
import { TenantDatabase } from '../database/tenant-database';
import { TokenCipher } from '../inventory/connection/token-cipher';
import { REDIS } from '../redis/redis.module';
import { ProjectDirectory } from '../tenants/project-directory';
import { createProject } from '../tenants/project-setup';
import { AccountStore } from './account-store';
import { LEAKED_PASSWORDS, type LeakedPasswords } from './passwords/leaked-passwords';
import { verifyPassword } from './passwords/password-hasher';
import { SessionService } from './session/session.service';
import { BackupCodeHasher } from './two-factor/backup-code-hasher';
import { totpStep } from './two-factor/totp';

export const CHALLENGE_TTL_SECONDS = 300;

const BAD_CREDENTIALS = 'That email or password is incorrect.';
const LOCKED = 'Too many attempts. Try again in 15 minutes.';
const TEMPORARY_EXPIRED = 'This temporary password has expired. Ask your super admin to add you again.';
const BAD_CODE = 'That code is incorrect.';
const EXPIRED_CHALLENGE = 'That sign-in has expired. Please start again.';
const LEAKED =
  'That password has appeared in a data breach. Please choose a different one.';

export type SignInOutcome =
  | { session: string; twoFactorChallenge?: undefined }
  | { twoFactorChallenge: string; session?: undefined };

export interface NewWorkspace {
  name: string;
  email: string;
  password: string;
  company: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly accounts: AccountStore,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly cipher: TokenCipher,
    @Inject(LEAKED_PASSWORDS) private readonly leaked: LeakedPasswords,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly projects: ProjectDirectory,
    private readonly backupCodes: BackupCodeHasher,
  ) {}

  async createWorkspace(
    { email, name, company }: { email: string; name: string; company: string },
    passwordHash: string,
    guard: (trx: TenantTransaction) => Promise<void>,
  ): Promise<Account> {
    return this.db.transaction().execute(async (trx) => {
      await guard(trx);
      const account = await trx
        .insertInto('accounts')
        .values({ email, display_name: name, password_hash: passwordHash, is_super_admin: true })
        .returningAll()
        .executeTakeFirstOrThrow();
      const { tenant, userId } = await createProject(trx, company, account);
      await this.audit.record(trx, {
        tenantId: tenant.id,
        action: 'auth.workspace_created',
        actor: { userId, email },
        metadata: { company },
      });
      return trx
        .updateTable('accounts')
        .set({ last_tenant_id: tenant.id })
        .where('id', '=', account.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async signIn(
    email: string,
    password: string,
    ipAddress: string | undefined,
  ): Promise<SignInOutcome> {
    const account = await this.accounts.findByEmail(email);
    if (account && this.accounts.isLocked(account)) {
      throw new UnauthorizedException(LOCKED);
    }
    const matches = await verifyPassword(account?.password_hash, password);
    if (!account || !matches) {
      if (account) {
        await this.accounts.recordFailure(account.id, 'failed_attempts');
        await this.recordAttempt(account, 'auth.sign_in.failed', ipAddress);
      }
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }
    const temporaryUntil = account.temporary_password_expires_at;
    if (temporaryUntil && temporaryUntil.getTime() <= Date.now()) {
      throw new UnauthorizedException(TEMPORARY_EXPIRED);
    }
    return this.finishPrimarySignIn(account, ipAddress);
  }

  async finishPrimarySignIn(
    account: Account,
    ipAddress: string | undefined,
  ): Promise<SignInOutcome> {
    if (account.totp_enabled_at) {
      await this.accounts.clearPasswordFailures(account.id);
      const twoFactorChallenge = newToken();
      await this.redis.set(
        this.challengeKey(twoFactorChallenge),
        account.id,
        'EX',
        CHALLENGE_TTL_SECONDS,
      );
      return { twoFactorChallenge };
    }
    await this.accounts.clearFailures(account.id);
    return { session: await this.createSession(account, ipAddress) };
  }

  async completeTwoFactor(
    challenge: string,
    code: string,
    ipAddress: string | undefined,
  ): Promise<string> {
    const key = this.challengeKey(challenge);
    const accountId = await this.redis.get(key);
    const account = accountId && (await this.accounts.findById(accountId));
    if (!account) {
      throw new UnauthorizedException(EXPIRED_CHALLENGE);
    }
    if (this.accounts.isLocked(account)) {
      throw new UnauthorizedException(LOCKED);
    }
    if (!(await this.acceptCode(account, code))) {
      await this.accounts.recordFailure(account.id, 'two_factor_failed_attempts');
      await this.recordAttempt(account, 'auth.two_factor.failed', ipAddress);
      throw new UnauthorizedException(BAD_CODE);
    }
    await this.redis.del(key);
    await this.accounts.clearFailures(account.id);
    return this.createSession(account, ipAddress);
  }

  async acceptCode(account: Account, code: string): Promise<boolean> {
    const trimmed = code.trim();
    const secret = account.totp_secret && this.cipher.decrypt<string>(account.totp_secret, `totp:${account.id}`);
    const step = secret ? totpStep(secret, trimmed) : null;
    if (step !== null && (await this.accounts.advanceTotpStep(account.id, step))) {
      return true;
    }
    return this.accounts.useBackupCode(account.id, this.backupCodes.candidates(trimmed));
  }

  async assertUsablePassword(password: string): Promise<void> {
    if (await this.leaked.isLeaked(password)) {
      throw new BadRequestException(LEAKED);
    }
  }

  private async createSession(account: Account, ipAddress: string | undefined): Promise<string> {
    const tenantId = await this.projects.landing(account);
    if (tenantId) {
      await this.database.run(tenantId, async (trx) => {
        const user = await trx
          .updateTable('users')
          .set({ last_login_at: new Date() })
          .where('account_id', '=', account.id)
          .returning(['id', 'email', 'role_id'])
          .executeTakeFirstOrThrow();
        const role = await trx
          .selectFrom('roles')
          .select('name')
          .where('id', '=', user.role_id)
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, {
          tenantId,
          action: 'auth.sign_in.succeeded',
          actor: { userId: user.id, email: user.email },
          ipAddress,
          metadata: { role: role.name },
        });
      });
    }
    await this.projects.remember(account.id, tenantId);
    return this.sessions.create(account.id, tenantId);
  }

  private async recordAttempt(
    account: Account,
    action: string,
    ipAddress: string | undefined,
  ): Promise<void> {
    const tenantId = account.last_tenant_id;
    if (!tenantId) {
      return;
    }
    await this.database.run(tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId,
        action,
        actor: { email: account.email },
        ipAddress,
      }),
    );
  }

  private challengeKey(challenge: string): string {
    return `auth:challenge:${hashToken(challenge)}`;
  }
}
