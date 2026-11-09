import type { AccountSettings, TwoFactorEnabled, TwoFactorSetup } from '@pulsegrid/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import QRCode from 'qrcode';
import { AuditService } from '../audit/audit.service';
import type { Account } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { TokenCipher } from '../inventory/connection/token-cipher';
import { AccountStore } from './account-store';
import { AuthService } from './auth.service';
import { hashPassword, verifyPassword } from './passwords/password-hasher';
import type { PersonContext } from './session/auth-context';
import { SessionService } from './session/session.service';
import { hashBackupCode, newBackupCodes, newTotpSecret, totpStep, totpUri } from './two-factor/totp';

const NO_ACCOUNT = 'We could not find your account.';
const BAD_PASSWORD = 'Your current password is incorrect.';
const BAD_CODE = 'That code is incorrect.';
const NOT_STARTED = 'Start two-factor setup again.';
const NO_TEMPORARY_PASSWORD = "You don't have a temporary password to replace.";
const SAME_PASSWORD = 'Choose a different password from the temporary one.';

@Injectable()
export class AccountService {
  constructor(
    private readonly accounts: AccountStore,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
    private readonly cipher: TokenCipher,
  ) {}

  async settings(auth: PersonContext): Promise<AccountSettings> {
    const account = await this.accountOf(auth);
    return {
      email: account.email,
      displayName: auth.displayName,
      hasPassword: account.password_hash !== null,
      twoFactorEnabled: account.totp_enabled_at !== null,
      backupCodesLeft: account.backup_codes.length,
    };
  }

  async changePassword(
    auth: PersonContext,
    currentPassword: string | undefined,
    newPassword: string,
    ipAddress: string | undefined,
  ): Promise<void> {
    const account = await this.accountOf(auth);
    if (account.password_hash && !(await verifyPassword(account.password_hash, currentPassword ?? ''))) {
      throw new BadRequestException(BAD_PASSWORD);
    }
    await this.auth.assertUsablePassword(newPassword);
    await this.accounts.update(account.id, { password_hash: await hashPassword(newPassword) });
    await this.record(auth, 'auth.password_changed', ipAddress, true);
  }

  async replaceTemporaryPassword(
    auth: PersonContext,
    newPassword: string,
    ipAddress: string | undefined,
  ): Promise<void> {
    const account = await this.accountOf(auth);
    if (!account.temporary_password_expires_at) {
      throw new ConflictException(NO_TEMPORARY_PASSWORD);
    }
    if (await verifyPassword(account.password_hash, newPassword)) {
      throw new BadRequestException(SAME_PASSWORD);
    }
    await this.auth.assertUsablePassword(newPassword);
    await this.accounts.update(account.id, {
      password_hash: await hashPassword(newPassword),
      temporary_password_expires_at: null,
    });
    await this.record(auth, 'auth.temporary_password_replaced', ipAddress, true);
  }

  async startTwoFactor(auth: PersonContext): Promise<TwoFactorSetup> {
    const account = await this.accountOf(auth);
    if (account.totp_enabled_at) {
      throw new ConflictException('Two-factor authentication is already on.');
    }
    const secret = newTotpSecret();
    await this.accounts.update(account.id, {
      totp_secret: this.cipher.encrypt(secret, `totp:${account.id}`),
    });
    return { secret, qrCode: await QRCode.toDataURL(totpUri(secret, account.email)) };
  }

  async confirmTwoFactor(
    auth: PersonContext,
    code: string,
    ipAddress: string | undefined,
  ): Promise<TwoFactorEnabled> {
    const account = await this.accountOf(auth);
    if (!account.totp_secret) {
      throw new BadRequestException(NOT_STARTED);
    }
    const secret = this.cipher.decrypt<string>(account.totp_secret, `totp:${account.id}`);
    const step = totpStep(secret, code);
    if (step === null) {
      throw new BadRequestException(BAD_CODE);
    }
    const backupCodes = newBackupCodes();
    await this.accounts.update(account.id, {
      totp_enabled_at: new Date(),
      totp_last_step: step,
      backup_codes: backupCodes.map(hashBackupCode),
    });
    await this.record(auth, 'auth.two_factor_enabled', ipAddress);
    return { backupCodes };
  }

  signOutOthers(auth: PersonContext, ipAddress: string | undefined): Promise<void> {
    return this.record(auth, 'auth.signed_out_elsewhere', ipAddress, true);
  }

  private async record(
    person: PersonContext,
    action: string,
    ipAddress: string | undefined,
    endOtherSessions = false,
  ): Promise<void> {
    if (endOtherSessions) {
      await this.sessions.revokeOthers(person.accountId, person.sessionId);
    }
    if (!person.project) {
      return;
    }
    const { tenantId, userId } = person.project;
    await this.database.run(tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId,
        action,
        actor: { userId, email: person.email },
        ipAddress,
      }),
    );
  }

  private async accountOf({ accountId }: PersonContext): Promise<Account> {
    const account = await this.accounts.findById(accountId);
    if (!account) {
      throw new NotFoundException(NO_ACCOUNT);
    }
    return account;
  }
}
