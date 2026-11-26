import type { DeviceToken } from '@pulsegrid/shared';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { createHash } from 'node:crypto';
import { hashToken, newToken } from '../../common/secure-token';
import { DATABASE } from '../../database/database.module';
import type { Database } from '../../database/schema';
import type { PersonContext } from '../session/auth-context';
import { SessionService } from '../session/session.service';

const CODE_TTL_MS = 2 * 60_000;
const EXPIRED = 'This sign-in has expired. Sign in again from the app.';

/** The PKCE check: the code goes only to the app that made the challenge. */
const challengeOf = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

/**
 * Carries a browser sign-in over to the iPhone app. The app signs in on PulseGrid's own page in the system
 * browser, which hands it a short-lived code; the app swaps the code, with its secret verifier, for its own token.
 */
@Injectable()
export class DeviceSignInService {
  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly sessions: SessionService,
  ) {}

  async createCode(person: PersonContext, challenge: string, deviceName: string): Promise<string> {
    const code = newToken();
    await this.db
      .insertInto('device_sign_in_codes')
      .values({
        code_hash: hashToken(code),
        account_id: person.accountId,
        tenant_id: person.project?.tenantId ?? null,
        challenge,
        device_name: deviceName,
        expires_at: new Date(Date.now() + CODE_TTL_MS),
      })
      .execute();
    return code;
  }

  /** Swaps a code once; a wrong verifier, a used code and an old code all fail the same way. */
  async exchange(code: string, verifier: string): Promise<DeviceToken & { tenantId: string | null; deviceName: string; accountId: string }> {
    const row = await this.db
      .deleteFrom('device_sign_in_codes')
      .where('code_hash', '=', hashToken(code))
      .returningAll()
      .executeTakeFirst();
    await this.db.deleteFrom('device_sign_in_codes').where('expires_at', '<', new Date()).execute();
    if (!row || row.expires_at.getTime() < Date.now() || row.challenge !== challengeOf(verifier)) {
      throw new UnauthorizedException(EXPIRED);
    }
    const { token, expiresAt } = await this.sessions.createForDevice(row.account_id, row.tenant_id, row.device_name);
    return {
      token,
      expiresAt: expiresAt.toISOString(),
      tenantId: row.tenant_id,
      deviceName: row.device_name,
      accountId: row.account_id,
    };
  }
}
