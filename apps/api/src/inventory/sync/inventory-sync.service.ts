import { passesTagFilter, type SyncIssue } from '@pulsegrid/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { DATABASE } from '../../database/database.module';
import type { CloudAccountRow, Database } from '../../database/schema';
import { TenantDatabase } from '../../database/tenant-database';
import { chunk } from '../../common/chunk';
import { CredentialVault } from '../connection/credential-vault';
import {
  type CloudCredentials,
  type CloudProvider,
  type CollectedResource,
  type CollectorContext,
  GLOBAL_REGION,
  type ResourceCollector,
} from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { ResourceStore } from './resource-store';
import { NO_SYNC_REPORTER, type SyncReporter } from './sync-tracker';

const COLLECTIONS_AT_ONCE = 4;

export interface AccountRef {
  tenantId: string;
  accountId: string;
}

interface CollectionTask {
  collector: ResourceCollector;
  region: string;
}

type CollectionResult = CollectionTask &
  ({ resources: CollectedResource[] } | { issue: SyncIssue });

@Injectable()
export class InventorySyncService {
  private readonly logger = new Logger(InventorySyncService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Kysely<Database>,
    private readonly database: TenantDatabase,
    private readonly store: ResourceStore,
    private readonly vault: CredentialVault,
    private readonly providers: ProviderRegistry,
  ) {}

  async connectedAccounts(): Promise<AccountRef[]> {
    const tenants = await this.db.selectFrom('tenants').select('id').execute();
    const accounts = await Promise.all(
      tenants.map(({ id: tenantId }) =>
        this.database.run(tenantId, async (trx) => {
          const rows = await trx
            .selectFrom('cloud_accounts')
            .select('id')
            .where('status', '=', 'connected')
            .where('encrypted_credentials', 'is not', null)
            .execute();
          return rows.map(({ id }) => ({ tenantId, accountId: id }));
        }),
      ),
    );
    return accounts.flat();
  }

  async syncAccount(
    { tenantId, accountId }: AccountRef,
    reporter: SyncReporter = NO_SYNC_REPORTER,
  ): Promise<void> {
    const account = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('cloud_accounts').selectAll().where('id', '=', accountId).executeTakeFirst(),
    );
    const credentials = account && this.vault.open(account);
    if (!account || !credentials) {
      return;
    }
    await reporter.accounts([{ id: account.id, name: account.name }]);
    await this.syncWith(tenantId, account, credentials, reporter);
  }

  private async syncWith(
    tenantId: string,
    account: CloudAccountRow,
    credentials: CloudCredentials,
    reporter: SyncReporter,
  ): Promise<void> {
    const seenAt = new Date();
    const provider = this.providers.get(account.provider);
    const results = await this.collect(account, provider, credentials, reporter);
    const scope = { tenantId, cloudAccountId: account.id, seenAt };

    await this.database.run(tenantId, async (trx) => {
      for (const result of results) {
        if ('resources' in result) {
          const kept = result.resources.filter(
            ({ type, tags }) =>
              provider.unfilteredTypes.includes(type) || passesTagFilter(account.tag_filter, tags),
          );
          await this.store.save(trx, scope, result.collector, kept);
          await this.store.removeMissing(trx, scope, result.collector, result.region);
        }
      }
      await trx
        .updateTable('cloud_accounts')
        .set({
          last_synced_at: seenAt,
          last_error: null,
          sync_issues: JSON.stringify(
            results.flatMap((result) => ('issue' in result ? [result.issue] : [])),
          ),
        })
        .where('id', '=', account.id)
        .execute();
    });
    await reporter.accountFinished(account.id);
  }

  private tasksFor(provider: CloudProvider, regions: readonly string[]): CollectionTask[] {
    return provider.collectors.flatMap((collector) =>
      collector.scope === 'global'
        ? [{ collector, region: GLOBAL_REGION }]
        : regions.map((region) => ({ collector, region })),
    );
  }

  private async collect(
    account: CloudAccountRow,
    provider: CloudProvider,
    credentials: CloudCredentials,
    reporter: SyncReporter,
  ): Promise<CollectionResult[]> {
    const tasks = this.tasksFor(provider, account.regions);

    await reporter.accountStarted(account.id, tasks.length);
    const results: CollectionResult[] = [];
    for (const batch of chunk(tasks, COLLECTIONS_AT_ONCE)) {
      results.push(
        ...(await Promise.all(
          batch.map(async (task) => {
            const { label } = task.collector;
            await reporter.taskStarted(account.id, label);
            const result = await this.runTask(provider, task, { credentials, region: task.region });
            await reporter.taskFinished(
              account.id,
              label,
              'issue' in result
                ? { issue: result.issue.message }
                : { resources: result.resources.length },
            );
            return result;
          }),
        )),
      );
    }
    return results;
  }

  private async runTask(
    provider: CloudProvider,
    task: CollectionTask,
    context: CollectorContext,
  ): Promise<CollectionResult> {
    const { collector, region } = task;
    try {
      return { ...task, resources: await collector.collect(context) };
    } catch (error) {
      this.logger.warn(`${collector.name} failed in ${region}: ${(error as Error).message}`);
      return {
        ...task,
        issue: {
          collector: collector.label,
          region,
          message: provider.failureMessage(error, collector.label),
        },
      };
    }
  }
}
