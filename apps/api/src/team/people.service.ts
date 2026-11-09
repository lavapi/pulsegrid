import { randomBytes } from 'node:crypto';
import type { NewPerson, Person, TemporaryPassword } from '@pulsegrid/shared';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { AuditService } from '../audit/audit.service';
import { AccountStore } from '../auth/account-store';
import { hashPassword } from '../auth/passwords/password-hasher';
import type { AuthContext } from '../auth/session/auth-context';
import { DATABASE } from '../database/database.module';
import { isUniqueViolation } from '../database/errors';
import type { Account, Database } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { ProjectDirectory } from '../tenants/project-directory';

const TEMPORARY_PASSWORD_LIFETIME_MS = 24 * 60 * 60 * 1000;
const TEMPORARY_PASSWORD_BYTES = 18;
const HAS_ACCOUNT = 'That email already has an account.';
const PERSON_MISSING = 'That person no longer exists.';
const SUPER_ADMIN_PROTECTED = 'Make someone else super admin first.';
const NOT_YOURSELF = "You can't remove yourself.";

const newTemporaryPassword = async () => {
  const password = randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
  return {
    password,
    passwordHash: await hashPassword(password),
    expiresAt: new Date(Date.now() + TEMPORARY_PASSWORD_LIFETIME_MS),
  };
};

@Injectable()
export class PeopleService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly accounts: AccountStore,
    private readonly projects: ProjectDirectory,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<Person[]> {
    const [accounts, memberships] = await Promise.all([
      this.db.selectFrom('accounts').selectAll().orderBy('email').execute(),
      this.projects.membersByProject(),
    ]);
    return accounts.map((account) => ({
      id: account.id,
      email: account.email,
      displayName: account.display_name,
      isSuperAdmin: account.is_super_admin,
      twoFactorEnabled: account.totp_enabled_at !== null,
      pendingPassword: account.temporary_password_expires_at !== null,
      projects: memberships.flatMap(({ project, members }) =>
        members
          .filter(({ accountId }) => accountId === account.id)
          .map(({ roleName }) => ({ id: project.id, name: project.name, roleName })),
      ),
    }));
  }

  async add(
    auth: AuthContext,
    { firstName, lastName, email }: NewPerson,
    ipAddress: string | undefined,
  ): Promise<{ account: Account; temporaryPassword: TemporaryPassword }> {
    const address = email.toLowerCase();
    if (await this.accounts.findByEmail(address)) {
      throw new ConflictException(HAS_ACCOUNT);
    }
    const { password, passwordHash, expiresAt } = await newTemporaryPassword();
    let account: Account;
    try {
      account = await this.db
        .insertInto('accounts')
        .values({
          email: address,
          display_name: `${firstName} ${lastName}`,
          password_hash: passwordHash,
          temporary_password_expires_at: expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(HAS_ACCOUNT);
      }
      throw error;
    }
    await this.record(auth, 'people.added', account, ipAddress);
    return { account, temporaryPassword: { password, expiresAt: expiresAt.toISOString() } };
  }

  async remove(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<void> {
    if (id === auth.accountId) {
      throw new ConflictException(NOT_YOURSELF);
    }
    const account = await this.find(id);
    if (account.is_super_admin) {
      throw new ConflictException(SUPER_ADMIN_PROTECTED);
    }
    await this.projects.leaveEverywhere(id);
    await this.db.deleteFrom('accounts').where('id', '=', id).execute();
    await this.record(auth, 'people.removed', account, ipAddress);
  }

  async makeSuperAdmin(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<void> {
    const account = await this.find(id);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('accounts').set({ is_super_admin: false }).where('is_super_admin', '=', true).execute();
      await trx.updateTable('accounts').set({ is_super_admin: true }).where('id', '=', id).execute();
    });
    await this.projects.seatEverywhere({ ...account, is_super_admin: true });
    await this.record(auth, 'team.ownership_transferred', account, ipAddress);
  }

  async find(id: string): Promise<Account> {
    const account = await this.accounts.findById(id);
    if (!account) {
      throw new NotFoundException(PERSON_MISSING);
    }
    return account;
  }

  private record(auth: AuthContext, action: string, account: Account, ipAddress: string | undefined) {
    return this.database.run(auth.tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId: auth.tenantId,
        action,
        actor: { userId: auth.userId, email: auth.email },
        target: { type: 'person', id: account.id },
        ipAddress,
        metadata: { label: account.email },
      }),
    );
  }
}
