import {
  type EnvironmentDomain,
  type Release,
  type ReleaseChoices,
  type ReleasesOverview,
  isActiveRelease,
  resourcePath,
} from '@pulsegrid/shared';
import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import { chunk } from '../common/chunk';
import { isUniqueViolation } from '../database/errors';
import { TenantDatabase } from '../database/tenant-database';
import { CredentialVault } from '../inventory/connection/credential-vault';
import { isKnownNonProductionName } from '../inventory/environments/environment-detection';
import { domainsByEnvironment } from '../inventory/environments/environment-domains';
import type { Deployment } from '../inventory/providers/provider';
import { ProviderRegistry } from '../inventory/providers/provider-registry';
import { PipelineCache } from '../pipelines/pipeline-cache';
import { PipelinesService } from '../pipelines/pipelines.service';
import { releaseProgress } from './release-stages';

const ROLLOUT_TTL_SECONDS = 10;
const RELEASES_AT_ONCE = 6;
const ROLLOUT_LABEL = 'the rollout';
const DEPLOY_TYPE = 'ecs-service';
const SERVICE_GONE = "We can't find this service any more. Sync the account, or remove this link.";
const NO_KEY = 'This account has no access key. Add one under Integrations.';
const TARGET_MISSING = 'That link no longer exists.';
const TARGET_EXISTS = 'That pipeline already deploys to that service.';
const SERVICE_MISSING = "That service isn't available. Only non-production services can be linked.";
const PIPELINE_MISSING = 'That pipeline no longer exists.';
const GIT_FAILED = "We couldn't read this pipeline just now.";

export interface NewReleaseTarget {
  appId: string;
  workflowId: string;
  accountId: string;
  nativeId: string;
}

interface TargetRow {
  id: string;
  app_id: string;
  app_name: string;
  workflow_id: string;
  cloud_account_id: string;
  native_id: string;
  service_name: string;
  environment_id: string | null;
  environment_name: string | null;
}

const rank = ({ state }: Release): number => {
  if (isActiveRelease(state)) {
    return 0;
  }
  return state === 'failed' ? 1 : 2;
};

const startedAt = ({ run }: Release): string => run?.startedAt ?? '';

const newestFirst = (releases: Release[]): Release[] =>
  releases.sort((first, second) => rank(first) - rank(second) || startedAt(second).localeCompare(startedAt(first)));

@Injectable()
export class ReleasesService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly pipelines: PipelinesService,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    private readonly cache: PipelineCache,
    private readonly audit: AuditService,
  ) {}

  async overview(tenantId: string): Promise<ReleasesOverview> {
    if (!(await this.pipelines.isConnected(tenantId))) {
      return { configured: false, releases: [] };
    }
    const { targets, domains } = await this.targets(tenantId);
    const appDomains = ({ environment_id: id }: TargetRow): EnvironmentDomain[] =>
      (id ? (domains.get(id) ?? []) : []).filter(({ kind }) => kind === 'app');
    const releases: Release[] = [];
    for (const batch of chunk(targets, RELEASES_AT_ONCE)) {
      releases.push(
        ...(await Promise.all(batch.map((target) => this.release(tenantId, target, appDomains(target))))),
      );
    }
    return { configured: true, releases: newestFirst(releases) };
  }

  async choices(tenantId: string): Promise<ReleaseChoices> {
    const [pipelines, services] = await Promise.all([
      this.pipelines.pipelineChoices(tenantId),
      this.serviceChoices(tenantId),
    ]);
    return {
      pipelines,
      services: services.map(({ accountId, nativeId, name, cluster, environment }) => ({
        accountId,
        nativeId,
        label: name,
        description: `${environment} · ${cluster}`,
      })),
    };
  }

  async link(auth: AuthContext, target: NewReleaseTarget, ipAddress: string | undefined): Promise<void> {
    const pipelines = await this.pipelines.pipelineChoices(auth.tenantId);
    if (!pipelines.some(({ appId, workflowId }) => appId === target.appId && workflowId === target.workflowId)) {
      throw new NotFoundException(PIPELINE_MISSING);
    }
    const services = await this.serviceChoices(auth.tenantId);
    const service = services.find(
      ({ accountId, nativeId }) => accountId === target.accountId && nativeId === target.nativeId,
    );
    if (!service) {
      throw new NotFoundException(SERVICE_MISSING);
    }
    try {
      await this.database.run(auth.tenantId, async (trx) => {
        const { id } = await trx
          .insertInto('release_targets')
          .values({
            tenant_id: auth.tenantId,
            app_id: target.appId,
            workflow_id: target.workflowId,
            cloud_account_id: target.accountId,
            native_id: target.nativeId,
            service_name: service.name,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.record(auth, 'pipeline.release_linked', id, service.name, ipAddress, trx);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(TARGET_EXISTS);
      }
      throw error;
    }
  }

  unlink(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<void> {
    return this.database.run(auth.tenantId, async (trx) => {
      const row = await trx
        .deleteFrom('release_targets')
        .where('id', '=', id)
        .returning('service_name')
        .executeTakeFirst();
      if (!row) {
        throw new NotFoundException(TARGET_MISSING);
      }
      await this.record(auth, 'pipeline.release_unlinked', id, row.service_name, ipAddress, trx);
    });
  }

  private record(
    auth: AuthContext,
    action: string,
    id: string,
    serviceName: string,
    ipAddress: string | undefined,
    trx: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'release_target', id },
      ipAddress,
      metadata: { label: serviceName },
    });
  }

  private targets(tenantId: string): Promise<{ targets: TargetRow[]; domains: Map<string, EnvironmentDomain[]> }> {
    return this.database.run(tenantId, async (trx) => ({
      domains: await domainsByEnvironment(trx),
      targets: await trx
        .selectFrom('release_targets')
        .innerJoin('pipeline_apps', 'pipeline_apps.id', 'release_targets.app_id')
        .innerJoin('cloud_accounts', 'cloud_accounts.id', 'release_targets.cloud_account_id')
        .leftJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
        .select([
          'release_targets.id',
          'release_targets.app_id',
          'release_targets.workflow_id',
          'release_targets.cloud_account_id',
          'release_targets.native_id',
          'release_targets.service_name',
          'pipeline_apps.name as app_name',
          'environments.id as environment_id',
          'environments.name as environment_name',
        ])
        .execute(),
    }));
  }

  private async serviceChoices(tenantId: string) {
    const rows = await this.database.run(tenantId, (trx) =>
      trx
        .selectFrom('resources')
        .innerJoin('cloud_accounts', 'cloud_accounts.id', 'resources.cloud_account_id')
        .innerJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
        .select([
          'resources.cloud_account_id',
          'resources.native_id',
          'resources.name',
          'resources.details',
          'environments.name as environment_name',
        ])
        .where('resources.type', '=', DEPLOY_TYPE)
        .orderBy('resources.name')
        .execute(),
    );
    return rows
      .filter(({ environment_name: name }) => isKnownNonProductionName(name))
      .map(({ cloud_account_id: accountId, native_id: nativeId, name, details, environment_name: environment }) => ({
        accountId,
        nativeId,
        name,
        environment,
        cluster: String(details['cluster'] ?? ''),
      }));
  }

  private async release(tenantId: string, target: TargetRow, appDomains: EnvironmentDomain[]): Promise<Release> {
    const pipeline = await this.pipeline(tenantId, target);
    const rollout = await this.rollout(tenantId, target);
    const issue = pipeline.issue ?? rollout.issue;
    const progress = releaseProgress(pipeline.run, pipeline.jobs, rollout.deployment, new Date());
    return {
      id: target.id,
      appId: target.app_id,
      appName: target.app_name,
      workflowId: target.workflow_id,
      pipelineName: pipeline.name,
      serviceName: target.service_name,
      servicePath: rollout.path,
      environmentName: target.environment_name,
      appDomains,
      run: pipeline.run,
      issue,
      ...progress,
    };
  }

  private async pipeline(tenantId: string, target: TargetRow) {
    try {
      const latest = await this.pipelines.latestRelease(
        tenantId,
        target.app_id,
        target.workflow_id,
        target.environment_name,
      );
      return { ...latest, issue: null };
    } catch (error) {
      return {
        name: target.workflow_id,
        run: null,
        jobs: [],
        issue: error instanceof HttpException ? error.message : GIT_FAILED,
      };
    }
  }

  private async rollout(
    tenantId: string,
    target: TargetRow,
  ): Promise<{ deployment: Deployment | null; path: string | null; issue: string | null }> {
    const { account, resource } = await this.database.run(tenantId, async (trx) => ({
      account: await trx
        .selectFrom('cloud_accounts')
        .selectAll()
        .where('id', '=', target.cloud_account_id)
        .executeTakeFirstOrThrow(),
      resource: await trx
        .selectFrom('resources')
        .selectAll()
        .where('cloud_account_id', '=', target.cloud_account_id)
        .where('native_id', '=', target.native_id)
        .executeTakeFirst(),
    }));
    if (!resource) {
      return { deployment: null, path: null, issue: SERVICE_GONE };
    }
    const path = resourcePath({ id: resource.id, type: resource.type });
    const provider = this.providers.get(account.provider);
    const credentials = this.vault.open(account);
    if (!provider.deploymentSource) {
      return { deployment: null, path, issue: null };
    }
    if (!credentials) {
      return { deployment: null, path, issue: NO_KEY };
    }
    const { deploymentSource } = provider;
    try {
      const deployment = await this.cache.remember<Deployment | null>(
        `rollout:${account.id}:${resource.native_id}`,
        ROLLOUT_TTL_SECONDS,
        () =>
          deploymentSource.read({
            credentials,
            region: resource.region,
            resource: { nativeId: resource.native_id, name: resource.name, details: resource.details },
          }),
      );
      return { deployment, path, issue: null };
    } catch (error) {
      return { deployment: null, path, issue: provider.failureMessage(error, ROLLOUT_LABEL) };
    }
  }
}
