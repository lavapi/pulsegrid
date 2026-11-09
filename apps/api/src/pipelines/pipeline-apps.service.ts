import type {
  PipelineActivity,
  PipelineApp,
  PipelineAppDetail,
  PipelineAppsOverview,
  RepositoryChoice,
} from '@pulsegrid/shared';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import { isUniqueViolation } from '../database/errors';
import { TenantDatabase } from '../database/tenant-database';
import { toAppSummary, toPipelineApp } from './pipeline-apps';
import { activityOf } from './pipeline-activity';
import { PipelinesService } from './pipelines.service';

const APP_EXISTS = 'An app with that name or repository already exists.';
const APP_MISSING = 'That app no longer exists.';

export interface NewPipelineApp {
  name: string;
  connectionId: string;
  repository: string;
}

@Injectable()
export class PipelineAppsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
    private readonly pipelines: PipelinesService,
  ) {}

  async activity(tenantId: string, scope?: string): Promise<PipelineActivity> {
    if (!(await this.pipelines.isConnected(tenantId))) {
      return { configured: false, running: [], failed: [], issues: [] };
    }
    const apps = await this.list(tenantId);
    const { pipelines, issues } = await this.pipelines.forApps(tenantId, apps, scope);
    return { configured: true, ...activityOf(pipelines, apps, new Date()), issues };
  }

  async overview(tenantId: string, scope?: string): Promise<PipelineAppsOverview> {
    if (!(await this.pipelines.isConnected(tenantId))) {
      return { configured: false, apps: [], issues: [] };
    }
    const apps = await this.list(tenantId);
    const { pipelines, issues } = await this.pipelines.forApps(tenantId, apps, scope);
    const summaries = await Promise.all(
      apps.map(async (app) =>
        toAppSummary(
          app,
          pipelines,
          await this.pipelines.deploymentTimes(tenantId, app),
        ),
      ),
    );
    return { configured: true, apps: summaries, issues };
  }

  async detail(tenantId: string, id: string, scope?: string): Promise<PipelineAppDetail> {
    const app = await this.find(tenantId, id);
    const { pipelines, issues } = await this.pipelines.forApps(tenantId, [app], scope);
    const deployments = await this.pipelines.deploymentTimes(tenantId, app);
    return { app, pipelines, deployments, issues };
  }

  async availableRepositories(tenantId: string): Promise<RepositoryChoice[]> {
    const [choices, apps] = await Promise.all([
      this.pipelines.repositoryChoices(tenantId),
      this.list(tenantId),
    ]);
    const isTaken = ({ connectionId, repository }: RepositoryChoice): boolean =>
      apps.some((app) => app.connectionId === connectionId && app.repository === repository);
    return choices
      .filter((choice) => !isTaken(choice))
      .sort((a, b) => a.repository.localeCompare(b.repository));
  }

  async create(
    auth: AuthContext,
    { name, connectionId, repository }: NewPipelineApp,
    ipAddress: string | undefined,
  ): Promise<PipelineApp> {
    const choices = await this.pipelines.repositoryChoices(auth.tenantId);
    const available = choices.some(
      (choice) => choice.connectionId === connectionId && choice.repository === repository,
    );
    if (!available) {
      throw new BadRequestException("That repository isn't available.");
    }
    try {
      return await this.database.run(auth.tenantId, async (trx) => {
        const row = await trx
          .insertInto('pipeline_apps')
          .values({ tenant_id: auth.tenantId, name, connection_id: connectionId, repository })
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.record(auth, 'pipeline.app_created', row, ipAddress, trx);
        return toPipelineApp(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(APP_EXISTS);
      }
      throw error;
    }
  }

  async remove(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<void> {
    await this.database.run(auth.tenantId, async (trx) => {
      const row = await trx
        .deleteFrom('pipeline_apps')
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst();
      if (!row) {
        throw new NotFoundException(APP_MISSING);
      }
      await this.record(auth, 'pipeline.app_deleted', row, ipAddress, trx);
    });
  }

  private record(
    auth: AuthContext,
    action: string,
    app: Pick<PipelineApp, 'id' | 'name' | 'repository'>,
    ipAddress: string | undefined,
    trx: Parameters<AuditService['record']>[0],
  ): Promise<void> {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'pipeline_app', id: app.id },
      ipAddress,
      metadata: { label: app.name, repository: app.repository },
    });
  }

  private async list(tenantId: string): Promise<PipelineApp[]> {
    const rows = await this.database.run(tenantId, (trx) =>
      trx
        .selectFrom('pipeline_apps')
        .selectAll()
        .orderBy(sql`lower(name)`)
        .execute(),
    );
    return rows.map(toPipelineApp);
  }

  private async find(tenantId: string, id: string): Promise<PipelineApp> {
    const row = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('pipeline_apps').selectAll().where('id', '=', id).executeTakeFirst(),
    );
    if (!row) {
      throw new NotFoundException(APP_MISSING);
    }
    return toPipelineApp(row);
  }
}
