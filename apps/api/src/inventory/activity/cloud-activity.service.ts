import type { CloudActivityPage } from '@pulsegrid/shared';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { TenantDatabase } from '../../database/tenant-database';
import { AccountCredentials, NOT_CONNECTED } from '../connection/account-credentials';
import type { ActivityQuery } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';

const ACCOUNT_MISSING = 'That cloud account is no longer connected.';
const NOT_SUPPORTED = "This provider can't show activity yet.";

@Injectable()
export class CloudActivityService {
  private readonly logger = new Logger(CloudActivityService.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly providers: ProviderRegistry,
    private readonly accountCredentials: AccountCredentials,
  ) {}

  async read(auth: AuthContext, accountId: string, query: ActivityQuery): Promise<CloudActivityPage> {
    const account = await this.database.run(auth.tenantId, (trx) =>
      trx.selectFrom('cloud_accounts').selectAll().where('id', '=', accountId).executeTakeFirst(),
    );
    if (!account) {
      throw new NotFoundException(ACCOUNT_MISSING);
    }
    const provider = this.providers.get(account.provider);
    if (!provider.activitySource) {
      throw new ConflictException(NOT_SUPPORTED);
    }
    const credentials = await this.accountCredentials.of(account);
    if (!credentials) {
      throw new ConflictException(NOT_CONNECTED);
    }
    try {
      const page = await provider.activitySource.read({ credentials, regions: account.regions }, query);
      return { ...page, error: null };
    } catch (error) {
      this.logger.warn(`Activity read failed: ${(error as Error).name}`);
      return { events: [], before: null, error: provider.actionFailureMessage(error) };
    }
  }
}
