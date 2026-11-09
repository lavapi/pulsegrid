import { randomBytes, timingSafeEqual } from 'node:crypto';
import { SETUP_CODE_EXPIRED } from '@pulsegrid/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import type { RedisClient } from '../redis/redis-connection';
import { type Kysely, sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/schema';
import { REDIS } from '../redis/redis.module';
import { AuthService, type NewWorkspace, type SignInOutcome } from './auth.service';
import { hashPassword } from './passwords/password-hasher';

const CODE_KEY = 'setup:code';
const CODE_BYTES = 12;
const SETUP_LOCK = 7_346_001;
const BAD_CODE = 'That setup code is incorrect.';
const ALREADY_DONE = 'This app has already been set up.';

const matches = (expected: string, actual: string): boolean => {
  const [first, second] = [Buffer.from(expected), Buffer.from(actual)];
  return first.length === second.length && timingSafeEqual(first, second);
};

@Injectable()
export class SetupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly auth: AuthService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (await this.isRequired()) {
      await this.announceCode();
    }
  }

  async isRequired(): Promise<boolean> {
    const account = await this.db.selectFrom('accounts').select('id').limit(1).executeTakeFirst();
    return !account;
  }

  async checkCode(code: string): Promise<void> {
    if (!(await this.isRequired())) {
      throw new ConflictException(ALREADY_DONE);
    }
    const expected = await this.redis.get(CODE_KEY);
    if (!expected) {
      await this.announceCode();
      throw new BadRequestException(SETUP_CODE_EXPIRED);
    }
    if (!matches(expected, code)) {
      throw new BadRequestException(BAD_CODE);
    }
  }

  async install(
    code: string,
    { name, email, password, company }: NewWorkspace,
    ipAddress: string | undefined,
  ): Promise<SignInOutcome> {
    await this.checkCode(code);
    await this.auth.assertUsablePassword(password);
    const account = await this.auth.createWorkspace(
      { email: email.toLowerCase(), name, company },
      await hashPassword(password),
      async (trx) => {
        await sql`select pg_advisory_xact_lock(${SETUP_LOCK})`.execute(trx);
        const existing = await trx.selectFrom('accounts').select('id').limit(1).executeTakeFirst();
        if (existing) {
          throw new ConflictException(ALREADY_DONE);
        }
      },
    );
    await this.redis.del(CODE_KEY);
    return this.auth.finishPrimarySignIn(account, ipAddress);
  }

  private async announceCode(): Promise<void> {
    const code = await this.currentCode();
    this.logger.log(`Setup code: ${code}. Open ${this.config.publicUrl}/setup to install.`);
  }

  private async currentCode(): Promise<string> {
    const code = randomBytes(CODE_BYTES).toString('hex');
    await this.redis.set(CODE_KEY, code, 'NX');
    return (await this.redis.get(CODE_KEY)) ?? code;
  }
}
