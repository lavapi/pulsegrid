import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AccountStore } from '../account-store';
import { AuthService } from '../auth.service';

const BAD_CODE = 'That code is incorrect.';
const LOCKED = 'Too many attempts. Try again in 15 minutes.';

/**
 * Asks again for the authenticator code (or a backup code) before a sensitive change. Wrong codes count towards the
 * same lock as signing in, and a code can't be used twice.
 */
@Injectable()
export class FreshCodeCheck {
  constructor(
    private readonly accounts: AccountStore,
    private readonly auth: AuthService,
  ) {}

  async confirm(accountId: string, code: string): Promise<void> {
    const account = await this.accounts.findById(accountId);
    if (!account) {
      throw new UnauthorizedException(BAD_CODE);
    }
    if (this.accounts.isLocked(account)) {
      throw new UnauthorizedException(LOCKED);
    }
    if (!(await this.auth.acceptCode(account, code))) {
      await this.accounts.recordFailure(account.id, 'two_factor_failed_attempts');
      throw new UnauthorizedException(BAD_CODE);
    }
    await this.accounts.clearFailures(account.id);
  }
}
