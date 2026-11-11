import {
  categoryOf,
  type ExperimentDetail,
  type ExperimentResource,
  type ExperimentSummary,
  type ExperimentsView,
  type ExperimentTemplate,
  type StartedExperiment,
} from '@pulsegrid/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { experimentAccess } from './experiment-access';
import { type ExperimentTarget, ExperimentGateway, STARTED_ACTION } from './experiment-gateway';
import { listGroups } from './experiment-groups.service';
import { recentRuns } from './experiment-runs.service';

const EXPERIMENT_MISSING = 'That failover test no longer exists in AWS.';

const byNewest = (first: ExperimentSummary, second: ExperimentSummary): number =>
  (second.startedAt ?? '').localeCompare(first.startedAt ?? '');

interface AwsExperiments {
  templates: ExperimentTemplate[];
  experiments: ExperimentSummary[];
  error: string | null;
}

@Injectable()
export class ExperimentsService {
  private readonly logger = new Logger(ExperimentsService.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly gateway: ExperimentGateway,
  ) {}

  async view(auth: AuthContext, accountId: string): Promise<ExperimentsView> {
    const target = await this.gateway.find(auth, accountId);
    const access = experimentAccess(target, auth.permissions);
    const [fromAws, saved] = await Promise.all([
      this.fromAws(target, access.blockedReason),
      this.database.run(auth.tenantId, async (trx) => ({
        groups: await listGroups(trx, accountId),
        runs: await recentRuns(trx, accountId),
      })),
    ]);
    return { ...fromAws, ...saved, access };
  }

  async detail(auth: AuthContext, accountId: string, region: string, id: string): Promise<ExperimentDetail> {
    const target = await this.gateway.find(auth, accountId);
    const record = await this.gateway.call(target, region, (source, context) => source.getExperiment(context, id));
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
    const target = await this.gateway.find(auth, accountId);
    await this.gateway.authorize(auth, target, {
      targetId: templateId,
      ipAddress,
      metadata: { label: templateId, region, cloudAccount: target.account.account_id },
    });
    const id = await this.gateway.start(auth, target, { region, templateId }, ipAddress);
    return { id, region };
  }

  async stop(auth: AuthContext, accountId: string, region: string, id: string, ipAddress: string | undefined) {
    const target = await this.gateway.find(auth, accountId);
    await this.gateway.authorize(auth, target, {
      targetId: id,
      ipAddress,
      metadata: { label: id, region, cloudAccount: target.account.account_id },
    });
    await this.gateway.stop(auth, target, region, id, ipAddress);
  }

  private async fromAws(target: ExperimentTarget, blockedReason: string | null): Promise<AwsExperiments> {
    const credentials = this.gateway.credentials(target);
    if (!credentials) {
      return { templates: [], experiments: [], error: blockedReason };
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
      return { templates, experiments, error: null };
    } catch (error) {
      this.logger.warn(`Experiment list failed: ${(error as Error).name}`);
      return { templates: [], experiments: [], error: target.source.failureMessage(error) };
    }
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
}
