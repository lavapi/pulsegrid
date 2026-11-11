import type { ResourceLoad } from '@pulsegrid/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { CredentialVault } from '../connection/credential-vault';
import type { MetricQuery } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceAccess } from '../resources/resource-access';

const NO_LOAD = "This resource doesn't have load to show.";
const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';

const empty = (error: string | null): ResourceLoad => ({
  available: true,
  charts: [],
  capacity: [],
  hiddenSeries: 0,
  error,
});

@Injectable()
export class ResourceLoadService {
  private readonly logger = new Logger(ResourceLoadService.name);

  constructor(
    private readonly access: ResourceAccess,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
  ) {}

  async read(auth: AuthContext, id: string, query: MetricQuery): Promise<ResourceLoad> {
    const { resource, account } = await this.access.load(auth, id);
    const source = this.providers.get(account.provider).metricSource;
    if (!source?.resourceTypes.includes(resource.type)) {
      throw new NotFoundException(NO_LOAD);
    }
    const credentials = this.vault.open(account);
    if (!credentials) {
      return empty(NO_CREDENTIALS);
    }
    try {
      const result = await source.read(
        {
          credentials,
          region: resource.region,
          resource: { type: resource.type, name: resource.name, nativeId: resource.native_id, details: resource.details },
        },
        query,
      );
      return { available: true, ...result, error: null };
    } catch (error) {
      this.logger.warn(`Load read failed: ${(error as Error).name}`);
      return empty(source.failureMessage(error));
    }
  }
}
