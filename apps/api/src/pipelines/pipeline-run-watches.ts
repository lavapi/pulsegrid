import { Injectable } from '@nestjs/common';
import { TenantDatabase } from '../database/tenant-database';

/** How long a run started from PulseGrid is followed; longer runs end without a notification. */
const WATCH_FOR_MS = 6 * 60 * 60 * 1000;

export interface WatchedRun {
  userId: string;
  appId: string;
  workflowId: string;
  pipelineName: string;
  branch: string;
  /** Null when the provider didn't say which run it started; it's found among the pipeline's runs later. */
  runId: string | null;
}

/** Runs people started or re-ran from PulseGrid, followed so they hear if one fails. */
@Injectable()
export class PipelineRunWatches {
  constructor(private readonly database: TenantDatabase) {}

  async add(tenantId: string, run: WatchedRun): Promise<void> {
    await this.database.run(tenantId, (trx) =>
      trx
        .insertInto('watched_pipeline_runs')
        .values({
          tenant_id: tenantId,
          user_id: run.userId,
          app_id: run.appId,
          workflow_id: run.workflowId,
          pipeline_name: run.pipelineName,
          branch: run.branch,
          run_id: run.runId,
          expires_at: new Date(Date.now() + WATCH_FOR_MS),
        })
        .execute(),
    );
  }
}
