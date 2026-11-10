import type { ActionRun, CloudPermission, ResourceActionOption } from '@pulsegrid/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { isUniqueViolation } from '../../database/errors';
import { CredentialVault } from '../connection/credential-vault';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceAccess } from '../resources/resource-access';
import { ActionQueue } from './action-queue';
import { actionOption } from './action-rules';
import { ActionRunStore, toActionRun } from './action-run.store';

const NOT_ALLOWED = 'You do not have permission to do that.';
const ALREADY_RUNNING = 'Another action is still running on this resource.';
const STARTING = 'Starting';
const MS_PER_MINUTE = 60_000;
const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';

@Injectable()
export class ResourceActionsService {
  private readonly logger = new Logger(ResourceActionsService.name);

  constructor(
    private readonly access: ResourceAccess,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    private readonly runs: ActionRunStore,
    private readonly queue: ActionQueue,
  ) {}

  async list(auth: AuthContext, id: string): Promise<ResourceActionOption[]> {
    const { resource, account, environment, granted } = await this.access.load(auth, id);
    return this.providers
      .get(account.provider)
      .actions.filter(
        ({ resourceType, permission }) => resourceType === resource.type && granted.has(permission),
      )
      .map(({ permission }) => actionOption(permission, environment));
  }

  async run(
    auth: AuthContext,
    id: string,
    permission: CloudPermission,
    ipAddress: string | undefined,
  ): Promise<ActionRun> {
    const { resource, account, environment, granted } = await this.access.load(auth, id);
    const metadata = { label: resource.name, permission, cloudAccount: account.account_id };
    const provider = this.providers.get(account.provider);
    const action = provider.actions.find(
      (item) => item.permission === permission && item.resourceType === resource.type,
    );
    if (!action || !granted.has(permission)) {
      await this.access.record(auth, 'access.denied', resource.id, ipAddress, metadata);
      throw new ForbiddenException(NOT_ALLOWED);
    }
    const { blockedReason } = actionOption(permission, environment);
    if (blockedReason) {
      await this.access.record(auth, 'access.denied', resource.id, ipAddress, metadata);
      throw new ConflictException(blockedReason);
    }
    const credentials = this.vault.open(account);
    if (!credentials) {
      throw new ConflictException(NO_CREDENTIALS);
    }
    const run = await this.claim(auth, resource.id, permission, action.timeoutMinutes);
    const context = {
      credentials,
      region: resource.region,
      resource: { nativeId: resource.native_id, name: resource.name, details: resource.details },
    };
    const start = await action.run(context).catch(async (error: unknown) => {
      this.logger.warn(`${permission} failed: ${(error as Error).name}`);
      const message = provider.actionFailureMessage(error);
      await this.runs.finish(auth.tenantId, run.id, { status: 'failed', summary: message });
      throw new BadRequestException(message);
    });
    const started = await this.runs.started(auth.tenantId, run.id, start.summary, start.trackingId);
    await this.access.record(auth, 'cloud.action.started', resource.id, ipAddress, metadata);
    await this.queue.scheduleCheck({ tenantId: auth.tenantId, runId: run.id });
    return toActionRun(started);
  }

  async latest(auth: AuthContext, id: string): Promise<ActionRun | null> {
    await this.runs.expireStale(auth.tenantId, id);
    const run = await this.runs.latest(auth.tenantId, id);
    return run ? toActionRun(run) : null;
  }

  async activity(auth: AuthContext, accountId: string): Promise<ActionRun[]> {
    const runs = await this.runs.forAccount(auth.tenantId, accountId);
    return runs.map(toActionRun);
  }

  private async claim(
    auth: AuthContext,
    resourceId: string,
    permission: CloudPermission,
    timeoutMinutes: number,
  ) {
    await this.runs.expireStale(auth.tenantId, resourceId);
    try {
      return await this.runs.claim({
        tenantId: auth.tenantId,
        resourceId,
        permission,
        summary: STARTING,
        userId: auth.userId,
        email: auth.email,
        expiresAt: new Date(Date.now() + timeoutMinutes * MS_PER_MINUTE),
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(ALREADY_RUNNING);
      }
      throw error;
    }
  }
}
