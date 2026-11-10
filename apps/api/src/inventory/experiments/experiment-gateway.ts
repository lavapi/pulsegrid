import { randomUUID } from 'node:crypto';
import type { ExperimentTemplateRef } from '@pulsegrid/shared';
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../../auth/session/auth-context';
import { TenantDatabase } from '../../database/tenant-database';
import { CredentialVault } from '../connection/credential-vault';
import { toAccountEnvironment } from '../environments/account-environment';
import type { CloudCredentials, ExperimentContext, ExperimentSource } from '../providers/provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { type ExperimentAccount, experimentAccess, NO_CREDENTIALS } from './experiment-access';

const ACCOUNT_MISSING = 'That cloud account is no longer connected.';
const NOT_SUPPORTED = "This provider can't run experiments yet.";
const REGION_MISSING = "That region isn't synced for this account.";

export const STARTED_ACTION = 'cloud.experiment.started';
export const STOPPED_ACTION = 'cloud.experiment.stopped';

export interface ExperimentTarget extends ExperimentAccount {
  source: ExperimentSource;
}

export interface AuditRecord {
  action: string;
  targetType?: string;
  targetId: string;
  ipAddress: string | undefined;
  metadata: Record<string, unknown>;
}

@Injectable()
export class ExperimentGateway {
  private readonly logger = new Logger(ExperimentGateway.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
    private readonly audit: AuditService,
  ) {}

  async find(auth: AuthContext, accountId: string): Promise<ExperimentTarget> {
    const row = await this.database.run(auth.tenantId, (trx) =>
      trx
        .selectFrom('cloud_accounts')
        .leftJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
        .selectAll('cloud_accounts')
        .select(['environments.name as environment_name', 'environments.is_production'])
        .where('cloud_accounts.id', '=', accountId)
        .executeTakeFirst(),
    );
    if (!row) {
      throw new NotFoundException(ACCOUNT_MISSING);
    }
    const { environment_name: name, is_production: isProduction, ...account } = row;
    const source = this.providers.get(account.provider).experimentSource;
    if (!source) {
      throw new ConflictException(NOT_SUPPORTED);
    }
    return { account, environment: toAccountEnvironment(name, isProduction), source };
  }

  async authorize(auth: AuthContext, target: ExperimentTarget, denied: Omit<AuditRecord, 'action'>): Promise<void> {
    const { blockedReason } = experimentAccess(target, auth.permissions);
    if (blockedReason) {
      await this.record(auth, { ...denied, action: 'access.denied' });
      throw new ForbiddenException(blockedReason);
    }
  }

  credentials(target: ExperimentTarget): CloudCredentials | null {
    return this.vault.open(target.account);
  }

  async call<T>(
    target: ExperimentTarget,
    region: string,
    work: (source: ExperimentSource, context: ExperimentContext) => Promise<T>,
  ): Promise<T> {
    if (!target.account.regions.includes(region)) {
      throw new NotFoundException(REGION_MISSING);
    }
    const credentials = this.credentials(target);
    if (!credentials) {
      throw new ConflictException(NO_CREDENTIALS);
    }
    try {
      return await work(target.source, { credentials, region });
    } catch (error) {
      this.logger.warn(`Experiment request failed: ${(error as Error).name}`);
      throw new ConflictException(target.source.failureMessage(error));
    }
  }

  async start(
    auth: AuthContext,
    target: ExperimentTarget,
    { region, templateId }: ExperimentTemplateRef,
    ipAddress: string | undefined,
  ): Promise<string> {
    const id = await this.call(target, region, (source, context) => source.start(context, templateId, randomUUID()));
    await this.record(auth, {
      action: STARTED_ACTION,
      targetId: id,
      ipAddress,
      metadata: { label: templateId, template: templateId, region, cloudAccount: target.account.account_id },
    });
    return id;
  }

  async stop(
    auth: AuthContext,
    target: ExperimentTarget,
    region: string,
    id: string,
    ipAddress: string | undefined,
  ): Promise<void> {
    await this.call(target, region, (source, context) => source.stop(context, id));
    await this.record(auth, {
      action: STOPPED_ACTION,
      targetId: id,
      ipAddress,
      metadata: { label: id, region, cloudAccount: target.account.account_id },
    });
  }

  record(auth: AuthContext, { action, targetType = 'experiment', targetId, ipAddress, metadata }: AuditRecord) {
    return this.database.run(auth.tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId: auth.tenantId,
        action,
        actor: { userId: auth.userId, email: auth.email },
        target: { type: targetType, id: targetId },
        ipAddress,
        metadata,
      }),
    );
  }
}
