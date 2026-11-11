import { testResult } from '@pulsegrid/shared';
import { Injectable, Logger } from '@nestjs/common';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import { ProviderRegistry } from '../providers/provider-registry';
import type { AccountRef } from '../sync/inventory-sync.service';
import { findExperimentAccount } from './experiment-account';
import { ExperimentReportStore, reportKey, reportsFor } from './experiment-report.store';

/** Saves a report for every test that has ended in an account, including tests started outside PulseGrid. */
@Injectable()
export class ExperimentReportCapture {
  private readonly logger = new Logger(ExperimentReportCapture.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    private readonly store: ExperimentReportStore,
  ) {}

  async captureAccount({ tenantId, accountId }: AccountRef): Promise<void> {
    const found = await this.database.run(tenantId, (trx) => findExperimentAccount(trx, accountId));
    const source = found && this.providers.get(found.account.provider).experimentSource;
    const credentials = found && this.vault.open(found.account);
    if (!found || !source || !credentials) {
      return;
    }
    for (const region of found.account.regions) {
      const context = { credentials, region };
      try {
        const ended = (await source.listExperiments(context)).filter(({ state }) => testResult(state));
        const saved = await this.database.run(tenantId, (trx) =>
          reportsFor(trx, accountId, ended.map(({ id }) => id)),
        );
        for (const { id } of ended.filter((item) => !saved.has(reportKey(item.region, item.id)))) {
          const record = await source.getExperiment(context, id);
          if (record) {
            await this.store.save(tenantId, found, record);
          }
        }
      } catch (error) {
        this.logger.warn(`Report capture failed in ${region}: ${(error as Error).name}`);
      }
    }
  }
}
