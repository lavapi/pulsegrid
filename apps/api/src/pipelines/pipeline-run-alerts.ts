import { Inject, Injectable, Logger } from '@nestjs/common';
import { isActivePipelineStatus, type PipelineRun } from '@pulsegrid/shared';
import type { Kysely, Selectable } from 'kysely';
import { DATABASE } from '../database/database.module';
import type { Database, WatchedPipelineRunsTable } from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';
import { PushNotifier } from '../push/push-notifier';
import { GitConnectionsService } from './git/git-connections.service';
import type { GitClient } from './git/git-provider';

/** A run counts as the one started when it began no earlier than this before PulseGrid asked for it. */
const CLOCK_SLACK_MS = 60_000;

type Watched = Selectable<WatchedPipelineRunsTable>;

interface Repository {
  repository: string;
  client: GitClient;
}

const startedSince = (run: PipelineRun, since: Date): boolean =>
  run.startedAt !== null && Date.parse(run.startedAt) >= since.getTime() - CLOCK_SLACK_MS;

/**
 * Follows runs people started or re-ran from PulseGrid, and tells the person on their phone when one fails. A run
 * GitHub didn't name when it started is found as the first manual run on its branch since then.
 */
@Injectable()
export class PipelineRunAlerts {
  private readonly logger = new Logger(PipelineRunAlerts.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly connections: GitConnectionsService,
    private readonly push: PushNotifier,
  ) {}

  async check(): Promise<void> {
    const tenants = await this.db.selectFrom('tenants').select('id').execute();
    for (const { id } of tenants) await this.checkProject(id);
  }

  private async checkProject(tenantId: string): Promise<void> {
    const watched = await this.database.run(tenantId, async (trx) => {
      await trx.deleteFrom('watched_pipeline_runs').where('expires_at', '<', new Date()).execute();
      return trx.selectFrom('watched_pipeline_runs').selectAll().orderBy('started_at').execute();
    });
    const repositories = new Map<string, Repository | null>();
    for (const watch of watched) {
      try {
        if (!repositories.has(watch.app_id)) repositories.set(watch.app_id, await this.repositoryOf(tenantId, watch.app_id));
        const repository = repositories.get(watch.app_id);
        if (repository) await this.follow(tenantId, watch, repository, watched);
      } catch (error) {
        this.logger.warn(`Following a pipeline run failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      }
    }
  }

  private async follow(tenantId: string, watch: Watched, { repository, client }: Repository, all: readonly Watched[]): Promise<void> {
    const runId = watch.run_id ?? (await this.findRun(tenantId, watch, repository, client, all));
    if (!runId) return;
    const run = await client.getRun(repository, runId);
    if (isActivePipelineStatus(run.status) || !startedSince(run, watch.started_at)) return;
    await this.database.run(tenantId, (trx) => trx.deleteFrom('watched_pipeline_runs').where('id', '=', watch.id).execute());
    if (run.status !== 'failure') return;
    this.push.toUser(tenantId, watch.user_id, 'failed_pipelines', {
      title: `${watch.pipeline_name} failed`,
      body: `${run.branch} · ${run.commit} “${run.title}”`,
      path: `/pipelines/runs/${watch.app_id}/${run.id}`,
      collapseId: `pipeline-${run.id}`,
    });
  }

  /** The first manual run on the branch since the watch began that no other watch has taken. */
  private async findRun(tenantId: string, watch: Watched, repository: string, client: GitClient, all: readonly Watched[]): Promise<string | null> {
    const taken = new Set(all.map(({ run_id }) => run_id).filter(Boolean));
    const runs = await client.listRuns(repository, watch.workflow_id);
    const found = runs
      .filter((run) => run.event === 'workflow_dispatch' && run.branch === watch.branch && startedSince(run, watch.started_at) && !taken.has(run.id))
      .sort((a, b) => Date.parse(a.startedAt ?? '') - Date.parse(b.startedAt ?? ''))[0];
    if (!found) return null;
    await this.database.run(tenantId, (trx) =>
      trx.updateTable('watched_pipeline_runs').set({ run_id: found.id }).where('id', '=', watch.id).execute(),
    );
    watch.run_id = found.id;
    return found.id;
  }

  private async repositoryOf(tenantId: string, appId: string): Promise<Repository | null> {
    const app = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('pipeline_apps').select(['repository', 'connection_id']).where('id', '=', appId).executeTakeFirst(),
    );
    const client = app?.connection_id ? await this.connections.clientFor(tenantId, app.connection_id) : null;
    return app && client ? { repository: app.repository, client } : null;
  }
}
