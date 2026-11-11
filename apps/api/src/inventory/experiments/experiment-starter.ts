import { randomUUID } from 'node:crypto';
import type { ExperimentTemplateRef } from '@pulsegrid/shared';
import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { CloudAccountRow } from '../../database/schema';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import type { ExperimentSource } from '../providers/provider';
import { NO_CREDENTIALS } from './experiment-access';
import { STARTED_ACTION } from './experiment-audit';

export const REGION_MISSING = "That region isn't synced for this account.";

export interface StartTarget {
  account: CloudAccountRow;
  source: ExperimentSource;
}

export interface StartRequest {
  tenantId: string;
  target: StartTarget;
  ref: ExperimentTemplateRef;
  actor: { userId: string; email: string } | { email: string } | undefined;
  ipAddress?: string;
}

export type StartOutcome =
  | { kind: 'started'; experimentId: string }
  /** The account is already running as many tests as it may; try again when one ends. */
  | { kind: 'busy'; message: string }
  | { kind: 'failed'; message: string };

/** Starts one test and records who started it. Used for single tests and for each test of a run. */
@Injectable()
export class ExperimentStarter {
  private readonly logger = new Logger(ExperimentStarter.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly vault: CredentialVault,
    private readonly audit: AuditService,
  ) {}

  async start({ tenantId, target: { account, source }, ref, actor, ipAddress }: StartRequest): Promise<StartOutcome> {
    if (!account.regions.includes(ref.region)) {
      return { kind: 'failed', message: REGION_MISSING };
    }
    const credentials = this.vault.open(account);
    if (!credentials) {
      return { kind: 'failed', message: NO_CREDENTIALS };
    }
    let experimentId: string;
    try {
      experimentId = await source.start({ credentials, region: ref.region }, ref.templateId, randomUUID());
    } catch (error) {
      this.logger.warn(`Experiment start failed: ${(error as Error).name}`);
      const message = source.failureMessage(error);
      return source.isQuotaFull(error) ? { kind: 'busy', message } : { kind: 'failed', message };
    }
    await this.database.run(tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId,
        action: STARTED_ACTION,
        actor,
        target: { type: 'experiment', id: experimentId },
        ipAddress,
        metadata: { label: ref.templateId, template: ref.templateId, region: ref.region, cloudAccount: account.account_id },
      }),
    );
    return { kind: 'started', experimentId };
  }
}
