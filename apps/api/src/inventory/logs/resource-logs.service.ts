import type { LogAccess, LogView } from '@pulsegrid/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { CredentialVault } from '../connection/credential-vault';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceAccess } from '../resources/resource-access';

const NO_LOGS = "This resource doesn't have logs.";
const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';
const NEEDS_PERMISSION = 'Ask your super admin for the View service logs permission.';

export interface LogRequest {
  since: Date;
  search?: string | undefined;
  opened: boolean;
}

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
  ) {}

  async read(
    auth: AuthContext,
    id: string,
    { since, search, opened }: LogRequest,
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
    if (opened) {
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
      const result = await source.read(context, { since, until: new Date(), search });
      return { access, ...result, error: null };
    } catch (error) {
      this.logger.warn(`Log read failed: ${(error as Error).name}`);
      return empty(access, provider.actionFailureMessage(error));
    }
  }
}
