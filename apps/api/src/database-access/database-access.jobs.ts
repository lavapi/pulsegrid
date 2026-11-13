import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { TenantDatabase } from '../database/tenant-database';
import { readable } from './database-access-errors';
import { DatabaseAccessOutside } from './database-access-outside';
import { DatabaseAccessTenants } from './database-access-tenants';
import type { GrantOutput, RevokeOutput, RunResult } from './database-access-workflows';
import { DatabaseAccessQueue, type FollowJob, type GrantJob } from './database-access.queue';
import { DatabaseAccessStore, type GrantRow } from './database-access.store';

const MINUTE_MS = 60_000;
const EXPIRY_REVOKE_FAILED = "PulseGrid's revoke at the end time failed; AWS's own schedule ends the access.";

/**
 * What the worker does. AWS's workflows do every step of granting and revoking; PulseGrid follows their runs,
 * records the result, and keeps its records in line with the expiry schedules in AWS.
 */
@Injectable()
export class DatabaseAccessJobs {
  private readonly logger = new Logger(DatabaseAccessJobs.name);

  constructor(
    private readonly store: DatabaseAccessStore,
    private readonly queue: DatabaseAccessQueue,
    private readonly tenants: DatabaseAccessTenants,
    private readonly outside: DatabaseAccessOutside,
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  /** Waits for a grant, extension or revoke run to end, then records how it ended. */
  async follow({ tenantId, grantId, kind }: FollowJob): Promise<void> {
    const grant = await this.store.find(tenantId, grantId);
    if (!grant?.execution_arn) {
      return;
    }
    const result = await this.run<GrantOutput & RevokeOutput>(tenantId, grant.execution_arn);
    if (kind === 'grant') {
      await this.finishGrant(grant, result);
    } else if (kind === 'extend') {
      await this.finishExtend(grant, result);
    } else {
      await this.finishRevoke(grant, result);
    }
  }

  /** At the end time: AWS's schedule ends the access; this makes sure, and marks the record expired. */
  async expire({ tenantId, grantId }: GrantJob): Promise<void> {
    const grant = await this.store.find(tenantId, grantId);
    if (grant?.status !== 'active' || grant.change || grant.expires_at.getTime() > Date.now() + MINUTE_MS) {
      return;
    }
    let note: string | null = null;
    try {
      const workflows = await this.tenants.workflows(tenantId);
      const result = await workflows.follow<RevokeOutput>(await workflows.startRevoke(grant.user_name));
      note = result.ok ? null : EXPIRY_REVOKE_FAILED;
    } catch {
      note = EXPIRY_REVOKE_FAILED;
    }
    if (await this.store.ended(tenantId, grantId, 'expired', null, note)) {
      await this.record(grant, 'database_access.expired', null, {});
    }
  }

  /**
   * Every 5 minutes, per project: lists the expiry schedules in AWS, shows access granted outside PulseGrid
   * (without removing it), and marks expired the records whose schedule is gone after their end.
   */
  async reconcile(): Promise<void> {
    for (const tenantId of await this.tenants.all()) {
      try {
        await this.reconcileTenant(tenantId);
      } catch (error) {
        this.logger.warn(`Checking database access failed: ${(error as Error).name}`);
      }
    }
  }

  private async reconcileTenant(tenantId: string): Promise<void> {
    const schedules = await (await this.tenants.workflows(tenantId)).scheduledExpiries();
    const open = await this.store.open(tenantId);
    const known = new Set(open.flatMap(({ user_id: userId }) => userId ?? []));
    const granting = open.filter(({ status }) => status === 'granting');
    const items = schedules.filter(
      ({ userId, expiresAt }) =>
        !known.has(userId) && !granting.some((grant) => sameMinute(grant.requested_expires_at, expiresAt)),
    );
    await this.outside.save(tenantId, items);

    const scheduled = new Set(schedules.map(({ userId }) => userId));
    const now = Date.now();
    for (const grant of open) {
      const gone = grant.status === 'active' && !grant.change && grant.user_id && !scheduled.has(grant.user_id);
      if (gone && grant.expires_at.getTime() <= now && (await this.store.ended(tenantId, grant.id, 'expired', null))) {
        await this.record(grant, 'database_access.expired', null, {});
      }
    }
  }

  private async run<Output>(tenantId: string, executionArn: string): Promise<RunResult<Output>> {
    try {
      return await (await this.tenants.workflows(tenantId)).follow<Output>(executionArn);
    } catch (error) {
      return { ok: false, failure: readable(error).message };
    }
  }

  private async finishGrant(grant: GrantRow, result: RunResult<GrantOutput>): Promise<void> {
    if (!result.ok) {
      if (await this.store.grantFailed(grant.tenant_id, grant.id, result.failure)) {
        await this.record(grant, 'database_access.grant_failed', grant.granted_by_email, { failure: result.failure });
      }
      return;
    }
    const expiresAt = new Date(result.output.expiresAt);
    if (await this.store.granted(grant.tenant_id, grant.id, result.output.userId, expiresAt)) {
      await this.queue.expireAt({ tenantId: grant.tenant_id, grantId: grant.id }, expiresAt);
      await this.record(grant, 'database_access.granted', grant.granted_by_email, {
        reason: grant.reason,
        expiresAt: expiresAt.toISOString(),
      });
    }
  }

  private async finishExtend(grant: GrantRow, result: RunResult<GrantOutput>): Promise<void> {
    if (!result.ok) {
      if (await this.store.changeFailed(grant.tenant_id, grant.id, result.failure)) {
        await this.record(grant, 'database_access.extend_failed', grant.change_by_email, { failure: result.failure });
      }
      return;
    }
    const expiresAt = new Date(result.output.expiresAt);
    if (await this.store.extended(grant.tenant_id, grant.id, expiresAt)) {
      await this.queue.expireAt({ tenantId: grant.tenant_id, grantId: grant.id }, expiresAt);
      await this.record(grant, 'database_access.extended', grant.change_by_email, {
        expiresAt: expiresAt.toISOString(),
      });
    }
  }

  private async finishRevoke(grant: GrantRow, result: RunResult<RevokeOutput>): Promise<void> {
    if (!result.ok) {
      if (await this.store.changeFailed(grant.tenant_id, grant.id, result.failure)) {
        await this.record(grant, 'database_access.revoke_failed', grant.change_by_email, { failure: result.failure });
      }
      return;
    }
    if (await this.store.ended(grant.tenant_id, grant.id, 'manual', grant.change_by_email)) {
      await this.queue.cancelExpiry(grant.id);
      await this.record(grant, 'database_access.revoked', grant.change_by_email, {
        signInsStopped: result.output.signInsStopped,
      });
    }
  }

  private record(
    grant: GrantRow,
    action: string,
    email: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.database.run(grant.tenant_id, (trx) =>
      this.audit.record(trx, {
        tenantId: grant.tenant_id,
        action,
        actor: email ? { email } : undefined,
        target: { type: 'database-access', id: grant.id },
        metadata: { label: grant.user_name, ...metadata },
      }),
    );
  }
}

const sameMinute = (a: Date | null, b: string | null): boolean =>
  Boolean(a && b) && Math.abs((a as Date).getTime() - Date.parse(b as string)) < MINUTE_MS;
