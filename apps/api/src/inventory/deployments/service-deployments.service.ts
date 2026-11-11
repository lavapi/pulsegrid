import type { ServiceDeploymentsView } from '@pulsegrid/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { CredentialVault } from '../connection/credential-vault';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceAccess } from '../resources/resource-access';

const NOT_A_SERVICE = "This resource doesn't have deployments to show.";
const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';
const RECENT_DEPLOYMENTS = 5;

@Injectable()
export class ServiceDeploymentsService {
  private readonly logger = new Logger(ServiceDeploymentsService.name);

  constructor(
    private readonly access: ResourceAccess,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
  ) {}

  /** A service's recent blue/green, canary or linear deployments. Everyone can see them, in every environment. */
  async recent(auth: AuthContext, id: string): Promise<ServiceDeploymentsView> {
    const { resource, account } = await this.access.load(auth, id);
    const source = this.providers.get(account.provider).deploymentSource;
    if (!source || source.resourceType !== resource.type) {
      throw new NotFoundException(NOT_A_SERVICE);
    }
    const credentials = this.vault.open(account);
    if (!credentials) {
      return { strategy: null, deployments: [], error: NO_CREDENTIALS };
    }
    const context = {
      credentials,
      region: resource.region,
      resource: { nativeId: resource.native_id, name: resource.name, details: resource.details },
    };
    try {
      return await source.recent(context, RECENT_DEPLOYMENTS);
    } catch (error) {
      this.logger.warn(`Deployment read failed: ${(error as Error).name}`);
      return { strategy: null, deployments: [], error: source.failureMessage(error) };
    }
  }
}
