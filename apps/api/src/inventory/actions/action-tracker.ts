import { Injectable, Logger } from '@nestjs/common';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import type { ActionProgress } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { SyncProgressStore } from '../sync/sync-progress.store';
import { SyncQueue } from '../sync/sync-queue';
import { ActionQueue, type ActionRunRef } from './action-queue';
import { ActionRunStore } from './action-run.store';

const KEY_GONE = "The action was sent, but this account's key was removed, so we can't confirm it finished.";

@Injectable()
export class ActionTracker {
  private readonly logger = new Logger(ActionTracker.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly runs: ActionRunStore,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    private readonly actionQueue: ActionQueue,
    private readonly syncQueue: SyncQueue,
    private readonly syncProgress: SyncProgressStore,
  ) {}

  async check(ref: ActionRunRef): Promise<void> {
    const { tenantId, runId } = ref;
    const run = await this.runs.find(tenantId, runId);
    if (run?.status !== 'running' || !run.permission) {
      return;
    }
    if (run.expires_at.getTime() <= Date.now()) {
      await this.runs.expireStale(tenantId, run.resource_id);
      await this.refreshAccount(ref, run.resource_id);
      return;
    }
    const progress = await this.progressOf(ref, run.resource_id, run.permission, run);
    if (!progress) {
      await this.actionQueue.scheduleCheck(ref);
      return;
    }
    if (progress.state === 'running') {
      await this.runs.report(tenantId, runId, progress.summary);
      await this.actionQueue.scheduleCheck(ref);
      return;
    }
    await this.runs.finish(tenantId, runId, { status: progress.state, summary: progress.summary });
    await this.refreshAccount(ref, run.resource_id);
  }

  private async progressOf(
    { tenantId }: ActionRunRef,
    resourceId: string,
    permission: string,
    run: { tracking_id: string | null; started_at: Date },
  ): Promise<ActionProgress | null> {
    const { resource, account } = await this.database.run(tenantId, async (trx) => {
      const row = await trx
        .selectFrom('resources')
        .selectAll()
        .where('id', '=', resourceId)
        .executeTakeFirstOrThrow();
      return {
        resource: row,
        account: await trx
          .selectFrom('cloud_accounts')
          .selectAll()
          .where('id', '=', row.cloud_account_id)
          .executeTakeFirstOrThrow(),
      };
    });
    const credentials = this.vault.open(account);
    if (!credentials) {
      return { state: 'unconfirmed', summary: KEY_GONE };
    }
    const action = this.providers
      .get(account.provider)
      .actions.find((item) => item.permission === permission && item.resourceType === resource.type);
    try {
      return (
        (await action?.track({
          credentials,
          region: resource.region,
          resource: { nativeId: resource.native_id, name: resource.name, details: resource.details },
          trackingId: run.tracking_id,
          startedAt: run.started_at,
        })) ?? null
      );
    } catch (error) {
      this.logger.warn(`Checking ${permission} failed: ${(error as Error).name}`);
      return null;
    }
  }

  private async refreshAccount({ tenantId }: ActionRunRef, resourceId: string): Promise<void> {
    const resource = await this.database.run(tenantId, (trx) =>
      trx
        .selectFrom('resources')
        .select('cloud_account_id')
        .where('id', '=', resourceId)
        .executeTakeFirst(),
    );
    if (resource) {
      const account = { tenantId, accountId: resource.cloud_account_id };
      await this.syncProgress.watch(account);
      await this.syncQueue.enqueue(account);
    }
  }
}
