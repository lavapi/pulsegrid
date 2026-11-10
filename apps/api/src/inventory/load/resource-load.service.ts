import type { LoadRange, ResourceLoad } from '@pulsegrid/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { CredentialVault } from '../connection/credential-vault';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceAccess } from '../resources/resource-access';

const NO_LOAD = "This resource doesn't have load to show.";
const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';
const MS_PER_MINUTE = 60_000;

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

  async read(auth: AuthContext, id: string, range: LoadRange): Promise<ResourceLoad> {
    const { resource, account } = await this.access.load(auth, id);
    const source = this.providers.get(account.provider).metricSource;
    if (!source?.resourceTypes.includes(resource.type)) {
      throw new NotFoundException(NO_LOAD);
    }
    const credentials = this.vault.open(account);
    if (!credentials) {
      return empty(NO_CREDENTIALS);
    }
    const until = new Date();
    const since = new Date(until.getTime() - range.minutes * MS_PER_MINUTE);
    try {
      const result = await source.read(
        {
          credentials,
          region: resource.region,
          resource: { type: resource.type, name: resource.name, details: resource.details },
        },
        { since, until, periodSeconds: range.periodSeconds },
      );
      return { available: true, ...result, error: null };
    } catch (error) {
      this.logger.warn(`Load read failed: ${(error as Error).name}`);
      return empty(source.failureMessage(error));
    }
  }
}
