import { type LogAccess, type LogView, LOG_RANGES } from '@pulsegrid/shared';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { CredentialVault } from '../connection/credential-vault';
import type { RedisClient } from '../../redis/redis-connection';
import { REDIS } from '../../redis/redis.module';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceAccess } from '../resources/resource-access';

const NO_LOGS = "This resource doesn't have logs.";
const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';
const NEEDS_PERMISSION = 'Ask your super admin for the View service logs permission.';
const MS_PER_MINUTE = 60_000;
const LONGEST_RANGE_MS = Math.max(...LOG_RANGES.map(({ minutes }) => minutes)) * MS_PER_MINUTE;
const VIEW_RECORD_SECONDS = 15 * 60;

export interface LogRequest {
  since: Date;
  search?: string | undefined;
}

const boundedSince = (since: Date, now: Date): Date =>
  new Date(Math.max(since.getTime(), now.getTime() - LONGEST_RANGE_MS));

const logAccess = (canRead: boolean): LogAccess =>
  canRead ? { allowed: true, reason: null } : { allowed: false, reason: NEEDS_PERMISSION };

const empty = (access: LogAccess, error: string | null = null): LogView => ({
  access,
  available: true,
  lines: [],
  error,
});

@Injectable()
export class ResourceLogsService {
  private readonly logger = new Logger(ResourceLogsService.name);

  constructor(
    private readonly access: ResourceAccess,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  async read(
    auth: AuthContext,
    id: string,
    { since, search }: LogRequest,
    ipAddress: string | undefined,
  ): Promise<LogView> {
    const { resource, account, granted } = await this.access.load(auth, id);
    const provider = this.providers.get(account.provider);
    const source = provider.logSource;
    if (!source || source.resourceType !== resource.type) {
      throw new NotFoundException(NO_LOGS);
    }
    const access = logAccess(granted.has('logs.read'));
    if (!access.allowed) {
      return empty(access);
    }
    const credentials = this.vault.open(account);
    if (!credentials) {
      return empty(access, NO_CREDENTIALS);
    }
    if (await this.firstViewInWindow(auth, id)) {
      await this.access.record(auth, 'logs.viewed', id, ipAddress, {
        label: resource.name,
        cloudAccount: account.account_id,
      });
    }
    try {
      const context = {
        credentials,
        region: resource.region,
        resource: { nativeId: resource.native_id, name: resource.name, details: resource.details },
      };
      const now = new Date();
      const result = await source.read(context, { since: boundedSince(since, now), until: now, search });
      return { access, ...result, error: null };
    } catch (error) {
      this.logger.warn(`Log read failed: ${(error as Error).name}`);
      return empty(access, provider.actionFailureMessage(error));
    }
  }

  private async firstViewInWindow({ tenantId, userId }: AuthContext, resourceId: string): Promise<boolean> {
    const key = `logs:viewed:${tenantId}:${userId}:${resourceId}`;
    return (await this.redis.set(key, '1', 'EX', VIEW_RECORD_SECONDS, 'NX')) === 'OK';
  }
}
