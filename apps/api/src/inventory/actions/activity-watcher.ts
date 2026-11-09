import { Injectable, Logger } from '@nestjs/common';
import type { CloudAccountRow } from '../../database/schema';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import type { ActivityWatch, CloudCredentials } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import type { AccountRef } from '../sync/inventory-sync.service';
import { ActionRunStore } from './action-run.store';

const PAUSE_AFTER_ERROR_MS = 2 * 60 * 1000;

@Injectable()
export class ActivityWatcher {
  private readonly logger = new Logger(ActivityWatcher.name);
  private readonly pausedUntil = new Map<string, number>();

  constructor(
    private readonly database: TenantDatabase,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    private readonly runs: ActionRunStore,
  ) {}

  async watch({ tenantId, accountId }: AccountRef): Promise<void> {
    const account = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('cloud_accounts').selectAll().where('id', '=', accountId).executeTakeFirst(),
    );
    const credentials = account && this.openCredentials(account);
    if (!account || !credentials) {
      return;
    }
    const watches = this.providers.get(account.provider).activityWatches;
    await Promise.all(
      account.regions.flatMap((region) =>
        watches.map((watch) => this.check(account, credentials, region, watch)),
      ),
    );
  }

  private openCredentials(account: CloudAccountRow): CloudCredentials | null {
    try {
      return this.vault.open(account);
    } catch (error) {
      this.logger.warn(`Reading the key failed: ${(error as Error).name}`);
      return null;
    }
  }

  private async check(
    account: CloudAccountRow,
    credentials: CloudCredentials,
    region: string,
    watch: ActivityWatch,
  ): Promise<void> {
    const key = `${account.id}:${region}:${watch.types.join()}`;
    if ((this.pausedUntil.get(key) ?? 0) > Date.now()) {
      return;
    }
    try {
      const detected = await watch.detect({ credentials, region });
      await this.runs.reconcile(account.tenant_id, {
        accountId: account.id,
        region,
        types: watch.types,
        detected,
      });
    } catch (error) {
      this.logger.warn(`Watching ${watch.types.join()} failed: ${(error as Error).name}`);
      this.pausedUntil.set(key, Date.now() + PAUSE_AFTER_ERROR_MS);
    }
  }
}
