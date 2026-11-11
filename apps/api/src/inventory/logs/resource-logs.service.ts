import { type LogAccess, type LogView, LOG_RANGES } from '@pulsegrid/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { CredentialVault } from '../connection/credential-vault';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceAccess } from '../resources/resource-access';
import { LogReads } from './log-reads';

const NO_LOGS = "This resource doesn't have logs.";
const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';
const NEEDS_PERMISSION = 'Ask your super admin for the View logs permission.';
const MS_PER_MINUTE = 60_000;
const LONGEST_RANGE_MS = Math.max(...LOG_RANGES.map(({ minutes }) => minutes)) * MS_PER_MINUTE;

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
    private readonly views: LogReads,
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
    await this.views.recordView(auth, resource, account.account_id, ipAddress);
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
}
