import type { LogAccess, LogProblem } from '@pulsegrid/shared';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import type { RedisClient } from '../../redis/redis-connection';
import { REDIS } from '../../redis/redis.module';
import { CredentialVault } from '../connection/credential-vault';
import { type CloudCredentials, type CloudProvider, LogsUnreadable } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceAccess } from '../resources/resource-access';

const NEEDS_PERMISSION = 'Ask your super admin for the View logs permission.';
const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';
const THROTTLED = /Throttl|TooMany|SlowDown|RateExceeded|LimitExceeded/;
const SLOW_DOWN = 'AWS asked PulseGrid to slow down. Try again in a moment.';
const READ_FAILED = "PulseGrid couldn't read this from AWS right now. Try again in a moment.";
const VIEW_RECORD_SECONDS = 15 * 60;

export const DENIED: LogAccess = { allowed: false, reason: NEEDS_PERMISSION };
export const ALLOWED: LogAccess = { allowed: true, reason: null };

export interface LogReadTarget {
  resource: {
    id: string;
    type: string;
    name: string;
    native_id: string;
    region: string;
    details: Record<string, unknown>;
  };
  account: { account_id: string; provider: string };
  provider: CloudProvider;
  credentials: CloudCredentials;
  /** Whether the person may see query strings and values. */
  sensitive: boolean;
}

export type LogReadStart =
  { kind: 'ready'; target: LogReadTarget } | { kind: 'blocked'; access: LogAccess; problem: LogProblem | null };

/**
 * The common start of every log read: the resource, the View logs permission, the account's key, and a record in
 * Activity once every 15 minutes per person and resource while they keep reading.
 */
@Injectable()
export class LogReads {
  private readonly logger = new Logger(LogReads.name);

  constructor(
    private readonly access: ResourceAccess,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  async start(
    auth: AuthContext,
    id: string,
    supports: (provider: CloudProvider, resourceType: string) => boolean,
    ipAddress: string | undefined,
  ): Promise<LogReadStart> {
    const { resource, account, granted } = await this.access.load(auth, id);
    const provider = this.providers.get(account.provider);
    if (!supports(provider, resource.type)) {
      throw new NotFoundException("This resource doesn't have these logs.");
    }
    if (!granted.has('logs.read')) {
      return { kind: 'blocked', access: DENIED, problem: null };
    }
    const credentials = this.vault.open(account);
    if (!credentials) {
      return { kind: 'blocked', access: ALLOWED, problem: { message: NO_CREDENTIALS, principal: null } };
    }
    await this.recordView(auth, resource, account.account_id, ipAddress);
    return {
      kind: 'ready',
      target: { resource, account, provider, credentials, sensitive: granted.has('logs.sensitive') },
    };
  }

  /** A failed read as something the person can act on; unexpected errors are logged by name only, never by content. */
  problemOf(error: unknown): LogProblem {
    if (error instanceof LogsUnreadable) {
      return error.problem;
    }
    const name = (error as Error).name ?? '';
    this.logger.warn(`Log read failed: ${name}`);
    return { message: THROTTLED.test(name) ? SLOW_DOWN : READ_FAILED, principal: null };
  }

  async recordView(
    auth: AuthContext,
    resource: { id: string; name: string },
    cloudAccount: string,
    ipAddress: string | undefined,
  ): Promise<void> {
    const key = `logs:viewed:${auth.tenantId}:${auth.userId}:${resource.id}`;
    if ((await this.redis.set(key, '1', 'EX', VIEW_RECORD_SECONDS, 'NX')) === 'OK') {
      await this.access.record(auth, 'logs.viewed', resource.id, ipAddress, { label: resource.name, cloudAccount });
    }
  }
}
