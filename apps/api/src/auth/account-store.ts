import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Account, Database } from '../database/schema';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

@Injectable()
export class AccountStore {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async findByEmail(email: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where(sql<string>`lower(email)`, '=', email.toLowerCase())
      .executeTakeFirst();
    return row ?? null;
  }

  async findById(id: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return row ?? null;
  }

  async findByIdentity(provider: string, subject: string): Promise<Account | null> {
    const row = await this.db
      .selectFrom('account_identities')
      .innerJoin('accounts', 'accounts.id', 'account_identities.account_id')
      .selectAll('accounts')
      .where('provider', '=', provider)
      .where('subject', '=', subject)
      .executeTakeFirst();
    return row ?? null;
  }

  async linkIdentity(accountId: string, provider: string, subject: string): Promise<void> {
    await this.db
      .insertInto('account_identities')
      .values({ account_id: accountId, provider, subject })
      .onConflict((conflict) => conflict.columns(['provider', 'subject']).doNothing())
      .execute();
  }

  async update(id: string, changes: Parameters<AccountStore['applyUpdate']>[1]): Promise<void> {
    await this.applyUpdate(id, changes);
  }

  private async applyUpdate(
    id: string,
    changes: {
      password_hash?: string | null;
      failed_attempts?: number;
      locked_until?: Date | null;
      totp_secret?: string | null;
      totp_enabled_at?: Date | null;
      totp_last_step?: number | null;
      backup_codes?: string[];
      temporary_password_expires_at?: Date | null;
    },
  ): Promise<void> {
    await this.db.updateTable('accounts').set(changes).where('id', '=', id).execute();
  }

  async recordFailure(account: Account): Promise<void> {
    const attempts = account.failed_attempts + 1;
    const locked = attempts >= MAX_FAILED_ATTEMPTS;
    await this.applyUpdate(account.id, {
      failed_attempts: locked ? 0 : attempts,
      ...(locked ? { locked_until: new Date(Date.now() + LOCK_MS) } : {}),
    });
  }

  clearFailures(id: string): Promise<void> {
    return this.applyUpdate(id, { failed_attempts: 0, locked_until: null });
  }

  isLocked({ locked_until: lockedUntil }: Account): boolean {
    return lockedUntil !== null && lockedUntil.getTime() > Date.now();
  }
}
