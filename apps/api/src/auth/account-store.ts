import { Inject, Injectable } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Account, Database } from '../database/schema';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_SECONDS = 15 * 60;

export type FailureCounter = 'failed_attempts' | 'two_factor_failed_attempts';

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
      two_factor_failed_attempts?: number;
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

  async recordFailure(id: string, counter: FailureCounter): Promise<void> {
    const column = sql.ref(counter);
    const reached = sql`${column} + 1 >= ${MAX_FAILED_ATTEMPTS}`;
    await sql`
      update accounts set
        ${column} = case when ${reached} then 0 else ${column} + 1 end,
        locked_until = case when ${reached} then now() + make_interval(secs => ${LOCK_SECONDS}) else locked_until end
      where id = ${id}
    `.execute(this.db);
  }

  clearPasswordFailures(id: string): Promise<void> {
    return this.applyUpdate(id, { failed_attempts: 0 });
  }

  clearFailures(id: string): Promise<void> {
    return this.applyUpdate(id, { failed_attempts: 0, two_factor_failed_attempts: 0, locked_until: null });
  }

  async advanceTotpStep(id: string, step: number): Promise<boolean> {
    const row = await this.db
      .updateTable('accounts')
      .set({ totp_last_step: step })
      .where('id', '=', id)
      .where((eb) => eb.or([eb('totp_last_step', 'is', null), eb('totp_last_step', '<', String(step))]))
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  async useBackupCode(id: string, hashes: readonly string[]): Promise<boolean> {
    const { rows } = await sql<{ id: string }>`
      update accounts set backup_codes = array(
        select code from unnest(backup_codes) as code where code <> all(${hashes}::text[])
      )
      where id = ${id} and backup_codes && ${hashes}::text[]
      returning id
    `.execute(this.db);
    return rows.length > 0;
  }

  isLocked({ locked_until: lockedUntil }: Account): boolean {
    return lockedUntil !== null && lockedUntil.getTime() > Date.now();
  }
}
