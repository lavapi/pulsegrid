import { Inject, Injectable, Logger } from '@nestjs/common';
import type { RedisClient } from '../../redis/redis-connection';
import { hashToken, newToken } from '../../common/secure-token';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { REDIS } from '../../redis/redis.module';
import { AccountStore } from '../account-store';
import { AuthService, type SignInOutcome } from '../auth.service';
import { GOOGLE_OAUTH, type GoogleOAuth, type GoogleProfile } from './google-oauth';

const PROVIDER = 'google';
const STATE_TTL_SECONDS = 600;

export type GoogleResult =
  | { kind: 'signed_in'; outcome: SignInOutcome }
  | { kind: 'failed'; error: string };

@Injectable()
export class GoogleSignInService {
  private readonly logger = new Logger(GoogleSignInService.name);

  constructor(
    @Inject(GOOGLE_OAUTH) private readonly google: GoogleOAuth | null,
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly accounts: AccountStore,
    private readonly auth: AuthService,
  ) {}

  isEnabled(): boolean {
    return this.google !== null;
  }

  async start(): Promise<string | null> {
    if (!this.google) {
      return null;
    }
    const state = newToken();
    await this.redis.set(this.key('state', state), '1', 'EX', STATE_TTL_SECONDS);
    return this.google.authorizeUrl(state, this.redirectUri());
  }

  async finish(
    state: string,
    code: string,
    ipAddress: string | undefined,
  ): Promise<GoogleResult> {
    const key = this.key('state', state);
    const pending = await this.redis.getdel(key);
    if (!pending || !this.google) {
      return { kind: 'failed', error: 'google_failed' };
    }
    const profile = await this.profile(code);
    if (!profile) {
      return { kind: 'failed', error: 'google_failed' };
    }
    if (!profile.emailVerified) {
      return { kind: 'failed', error: 'google_unverified' };
    }
    const account =
      (await this.accounts.findByIdentity(PROVIDER, profile.subject)) ??
      (await this.accounts.findByEmail(profile.email));
    if (!account) {
      return { kind: 'failed', error: 'no_access' };
    }
    await this.accounts.linkIdentity(account.id, PROVIDER, profile.subject);
    return {
      kind: 'signed_in',
      outcome: await this.auth.finishPrimarySignIn(account, ipAddress),
    };
  }

  private async profile(code: string): Promise<GoogleProfile | null> {
    try {
      return (await this.google?.profileFor(code, this.redirectUri())) ?? null;
    } catch (error) {
      this.logger.warn((error as Error).message);
      return null;
    }
  }

  private redirectUri(): string {
    return `${this.config.publicUrl}/api/auth/google/callback`;
  }

  private key(kind: string, value: string): string {
    return `auth:google:${kind}:${hashToken(value)}`;
  }
}
