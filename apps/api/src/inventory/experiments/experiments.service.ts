import { randomUUID } from 'node:crypto';
import {
  categoryOf,
  type ExperimentDetail,
  type ExperimentResource,
  type ExperimentSummary,
  type ExperimentsView,
  type StartedExperiment,
} from '@pulsegrid/shared';
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../../auth/session/auth-context';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import { toAccountEnvironment } from '../environments/account-environment';
import type { ExperimentContext, ExperimentSource } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { type ExperimentAccount, experimentAccess, NO_CREDENTIALS } from './experiment-access';

const ACCOUNT_MISSING = 'That cloud account is no longer connected.';
const NOT_SUPPORTED = "This provider can't run experiments yet.";
const EXPERIMENT_MISSING = 'That experiment no longer exists in AWS.';
const REGION_MISSING = "That region isn't synced for this account.";
const STARTED_ACTION = 'cloud.experiment.started';

const byNewest = (first: ExperimentSummary, second: ExperimentSummary): number =>
  (second.startedAt ?? '').localeCompare(first.startedAt ?? '');

interface Target extends ExperimentAccount {
  source: ExperimentSource;
}

@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    private readonly audit: AuditService,
  ) {}

  async view(auth: AuthContext, accountId: string): Promise<ExperimentsView> {
    const target = await this.target(auth, accountId);
    const access = experimentAccess(target, auth.permissions);
    const credentials = this.vault.open(target.account);
    if (!credentials) {
      return { templates: [], experiments: [], access, error: access.blockedReason };
    }
    try {
      const perRegion = await Promise.all(
        target.account.regions.map(async (region) => {
          const context = { credentials, region };
          const [templates, experiments] = await Promise.all([
            target.source.listTemplates(context),
            target.source.listExperiments(context),
          ]);
          return { templates, experiments };
        }),
      );
      const templates = perRegion.flatMap((item) => item.templates);
      const labels = new Map(templates.map(({ id, label }) => [id, label]));
      const experiments = perRegion
        .flatMap((item) => item.experiments)
        .map((experiment) => ({ ...experiment, label: labels.get(experiment.templateId) ?? experiment.label }))
        .sort(byNewest);
      return { templates, experiments, access, error: null };
    } catch (error) {
      this.logger.warn(`Experiment list failed: ${(error as Error).name}`);
      return { templates: [], experiments: [], access, error: target.source.failureMessage(error) };
    }
  }

  async detail(auth: AuthContext, accountId: string, region: string, id: string): Promise<ExperimentDetail> {
    const target = await this.target(auth, accountId);
    const record = await this.call(target, region, (source, context) => source.getExperiment(context, id));
    if (!record) {
      throw new NotFoundException(EXPERIMENT_MISSING);
    }
    const { resolvedResourceIds, ...experiment } = record;
    const listed = experiment.targets.flatMap(({ resourceIds }) => resourceIds);
    const wanted = [...new Set([...resolvedResourceIds, ...listed])];
    return this.database.run(auth.tenantId, async (trx) => ({
      ...experiment,
      startedBy: await this.startedBy(trx, id),
      resources: await this.knownResources(trx, accountId, wanted),
      access: experimentAccess(target, auth.permissions),
    }));
  }

  async start(
    auth: AuthContext,
    accountId: string,
    region: string,
    templateId: string,
    ipAddress: string | undefined,
  ): Promise<StartedExperiment> {
    const target = await this.target(auth, accountId);
    const metadata = { label: templateId, region, cloudAccount: target.account.account_id };
    await this.assertAllowed(auth, target, templateId, ipAddress, metadata);
    const id = await this.call(target, region, (source, context) =>
      source.start(context, templateId, randomUUID()),
    );
    await this.record(auth, STARTED_ACTION, id, ipAddress, { ...metadata, template: templateId });
    return { id, region };
  }

  async stop(auth: AuthContext, accountId: string, region: string, id: string, ipAddress: string | undefined) {
    const target = await this.target(auth, accountId);
    const metadata = { label: id, region, cloudAccount: target.account.account_id };
    await this.assertAllowed(auth, target, id, ipAddress, metadata);
    await this.call(target, region, (source, context) => source.stop(context, id));
    await this.record(auth, 'cloud.experiment.stopped', id, ipAddress, metadata);
  }

  private async assertAllowed(
    auth: AuthContext,
    target: Target,
    targetId: string,
    ipAddress: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const { blockedReason } = experimentAccess(target, auth.permissions);
    if (blockedReason) {
      await this.record(auth, 'access.denied', targetId, ipAddress, metadata);
      throw new ForbiddenException(blockedReason);
    }
  }

  private async call<T>(
    target: Target,
    region: string,
    work: (source: ExperimentSource, context: ExperimentContext) => Promise<T>,
  ): Promise<T> {
    if (!target.account.regions.includes(region)) {
      throw new NotFoundException(REGION_MISSING);
    }
    const credentials = this.vault.open(target.account);
    if (!credentials) {
      throw new ConflictException(NO_CREDENTIALS);
    }
    try {
      return await work(target.source, { credentials, region });
    } catch (error) {
      this.logger.warn(`Experiment request failed: ${(error as Error).name}`);
      throw new ConflictException(target.source.failureMessage(error));
    }
  }

  private async target(auth: AuthContext, accountId: string): Promise<Target> {
    const row = await this.database.run(auth.tenantId, (trx) =>
      trx
        .selectFrom('cloud_accounts')
        .leftJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
        .selectAll('cloud_accounts')
        .select(['environments.name as environment_name', 'environments.is_production'])
        .where('cloud_accounts.id', '=', accountId)
        .executeTakeFirst(),
    );
    if (!row) {
      throw new NotFoundException(ACCOUNT_MISSING);
    }
    const { environment_name: name, is_production: isProduction, ...account } = row;
    const source = this.providers.get(account.provider).experimentSource;
    if (!source) {
      throw new ConflictException(NOT_SUPPORTED);
    }
    return { account, environment: toAccountEnvironment(name, isProduction), source };
  }

  private async startedBy(trx: TenantTransaction, experimentId: string): Promise<string | null> {
    const event = await trx
      .selectFrom('audit_events')
      .select('actor_email')
      .where('action', '=', STARTED_ACTION)
      .where('target_id', '=', experimentId)
      .executeTakeFirst();
    return event?.actor_email ?? null;
  }

  private async knownResources(
    trx: TenantTransaction,
    accountId: string,
    nativeIds: readonly string[],
  ): Promise<ExperimentResource[]> {
    if (nativeIds.length === 0) {
      return [];
    }
    const rows = await trx
      .selectFrom('resources')
      .select(['id', 'name', 'type'])
      .where('cloud_account_id', '=', accountId)
      .where('native_id', 'in', nativeIds)
      .orderBy('name')
      .execute();
    return rows.map(({ id, name, type }) => ({
      id,
      name,
      type,
      path: `/infrastructure/${categoryOf(type)}/${id}`,
    }));
  }

  private record(
    auth: AuthContext,
    action: string,
    targetId: string,
    ipAddress: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.database.run(auth.tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId: auth.tenantId,
        action,
        actor: { userId: auth.userId, email: auth.email },
        target: { type: 'experiment', id: targetId },
        ipAddress,
        metadata,
      }),
    );
  }
}
