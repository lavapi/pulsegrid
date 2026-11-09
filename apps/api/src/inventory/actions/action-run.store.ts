import {
  type ActionRun,
  type ActionRunStatus,
  CLOUD_ACTIONS,
  type CloudPermission,
  isCloudPermission,
  type ResourceType,
} from '@pulsegrid/shared';
import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { ActionRunRow } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import type { DetectedActivity } from '../providers/provider';

const RESULT_VISIBLE_MS = 60 * 60 * 1000;
const OUTSIDE_ACTIVITY_LEASE_MS = 10 * 60 * 1000;
const ACTIVITY_FINISHED = 'No longer running in AWS';
const UNKNOWN_ACTIVITY = 'Activity';
const TIMED_OUT = 'Timed out. Check this in AWS, because it may still be running.';

const AUDIT_ACTIONS: Record<Exclude<ActionRunStatus, 'running'>, string> = {
  succeeded: 'cloud.action.completed',
  failed: 'cloud.action.failed',
  timed_out: 'cloud.action.timed_out',
  unconfirmed: 'cloud.action.unconfirmed',
};

export interface NewActionRun {
  tenantId: string;
  resourceId: string;
  permission: CloudPermission;
  summary: string;
  userId: string;
  email: string;
  expiresAt: Date;
}

export interface FinishedRun {
  status: Exclude<ActionRunStatus, 'running'>;
  summary: string;
}

export interface ActivityReport {
  accountId: string;
  region: string;
  types: readonly ResourceType[];
  detected: readonly DetectedActivity[];
}

const titleOf = ({ title, permission }: ActionRunRow): string => {
  if (title) {
    return title;
  }
  return permission && isCloudPermission(permission)
    ? CLOUD_ACTIONS[permission].buttonLabel
    : UNKNOWN_ACTIVITY;
};

export const toActionRun = (row: ActionRunRow): ActionRun => ({
  id: row.id,
  resourceId: row.resource_id,
  title: titleOf(row),
  status: row.status,
  summary: row.summary,
  startedBy: row.started_by_email,
  startedAt: row.started_at.toISOString(),
  finishedAt: row.finished_at?.toISOString() ?? null,
});

@Injectable()
export class ActionRunStore {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  claim(run: NewActionRun): Promise<ActionRunRow> {
    return this.database.run(run.tenantId, (trx) =>
      trx
        .insertInto('action_runs')
        .values({
          tenant_id: run.tenantId,
          resource_id: run.resourceId,
          permission: run.permission,
          summary: run.summary,
          started_by_user_id: run.userId,
          started_by_email: run.email,
          expires_at: run.expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  started(tenantId: string, id: string, summary: string, trackingId: string | null): Promise<ActionRunRow> {
    return this.database.run(tenantId, (trx) =>
      trx
        .updateTable('action_runs')
        .set({ summary, tracking_id: trackingId })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow(),
    );
  }

  async report(tenantId: string, id: string, summary: string): Promise<void> {
    await this.database.run(tenantId, (trx) =>
      trx.updateTable('action_runs').set({ summary }).where('id', '=', id).execute(),
    );
  }

  async finish(tenantId: string, id: string, result: FinishedRun): Promise<boolean> {
    return this.database.run(tenantId, async (trx) => Boolean(await this.close(trx, id, result)));
  }

  find(tenantId: string, id: string): Promise<ActionRunRow | undefined> {
    return this.database.run(tenantId, (trx) =>
      trx.selectFrom('action_runs').selectAll().where('id', '=', id).executeTakeFirst(),
    );
  }

  async expireStale(tenantId: string, resourceId: string): Promise<void> {
    await this.database.run(tenantId, async (trx) => {
      const stale = await trx
        .selectFrom('action_runs')
        .select('id')
        .where('resource_id', '=', resourceId)
        .where('status', '=', 'running')
        .where('expires_at', '<=', new Date())
        .execute();
      for (const { id } of stale) {
        await this.close(trx, id, { status: 'timed_out', summary: TIMED_OUT });
      }
    });
  }

  latest(tenantId: string, resourceId: string): Promise<ActionRunRow | undefined> {
    return this.database.run(tenantId, (trx) =>
      trx
        .selectFrom('action_runs')
        .selectAll()
        .where('resource_id', '=', resourceId)
        .where((eb) =>
          eb.or([
            eb('status', '=', 'running'),
            eb('finished_at', '>', new Date(Date.now() - RESULT_VISIBLE_MS)),
          ]),
        )
        .orderBy('started_at', 'desc')
        .limit(1)
        .executeTakeFirst(),
    );
  }

  forAccount(tenantId: string, accountId: string): Promise<ActionRunRow[]> {
    return this.database.run(tenantId, async (trx) => {
      const stale = await trx
        .selectFrom('action_runs')
        .innerJoin('resources', 'resources.id', 'action_runs.resource_id')
        .select('action_runs.id')
        .where('resources.cloud_account_id', '=', accountId)
        .where('action_runs.status', '=', 'running')
        .where('action_runs.expires_at', '<=', new Date())
        .execute();
      for (const { id } of stale) {
        await this.close(trx, id, { status: 'timed_out', summary: TIMED_OUT });
      }
      return trx
        .selectFrom('action_runs')
        .innerJoin('resources', 'resources.id', 'action_runs.resource_id')
        .selectAll('action_runs')
        .distinctOn('action_runs.resource_id')
        .where('resources.cloud_account_id', '=', accountId)
        .where((eb) =>
          eb.or([
            eb('action_runs.status', '=', 'running'),
            eb('action_runs.finished_at', '>', new Date(Date.now() - RESULT_VISIBLE_MS)),
          ]),
        )
        .orderBy('action_runs.resource_id')
        .orderBy('action_runs.started_at', 'desc')
        .execute();
    });
  }

  reconcile(tenantId: string, { accountId, region, types, detected }: ActivityReport): Promise<void> {
    return this.database.run(tenantId, async (trx) => {
      const resources = await trx
        .selectFrom('resources')
        .select(['id', 'native_id', 'name'])
        .where('cloud_account_id', '=', accountId)
        .where('region', '=', region)
        .where('type', 'in', [...types])
        .execute();
      const ids = resources.map(({ id }) => id);
      if (ids.length === 0) {
        return;
      }
      const active = await trx
        .selectFrom('action_runs')
        .selectAll()
        .where('resource_id', 'in', ids)
        .where('status', '=', 'running')
        .execute();
      const seen = new Set<string>();
      const leaseEnd = new Date(Date.now() + OUTSIDE_ACTIVITY_LEASE_MS);
      for (const item of detected) {
        const resource = resources.find(({ native_id: nativeId }) => nativeId === item.nativeId);
        if (!resource) {
          continue;
        }
        seen.add(resource.id);
        const run = active.find(({ resource_id: resourceId }) => resourceId === resource.id);
        if (run?.permission) {
          continue;
        }
        if (run && item.failed) {
          await this.close(trx, run.id, { status: 'failed', summary: item.summary });
        } else if (run) {
          await trx
            .updateTable('action_runs')
            .set({ summary: item.summary, expires_at: leaseEnd })
            .where('id', '=', run.id)
            .execute();
        } else if (!item.failed) {
          await this.open(trx, tenantId, resource, item, leaseEnd);
        }
      }
      for (const run of active) {
        if (!run.permission && !seen.has(run.resource_id)) {
          await this.close(trx, run.id, { status: 'succeeded', summary: ACTIVITY_FINISHED });
        }
      }
    });
  }

  private async open(
    trx: TenantTransaction,
    tenantId: string,
    resource: { id: string; name: string },
    item: DetectedActivity,
    expiresAt: Date,
  ): Promise<void> {
    const inserted = await trx
      .insertInto('action_runs')
      .values({
        tenant_id: tenantId,
        resource_id: resource.id,
        permission: null,
        title: item.title,
        summary: item.summary,
        started_by_user_id: null,
        started_by_email: null,
        expires_at: expiresAt,
      })
      .onConflict((conflict) => conflict.column('resource_id').where('status', '=', 'running').doNothing())
      .returning('id')
      .executeTakeFirst();
    if (inserted) {
      await this.audit.record(trx, {
        tenantId,
        action: 'cloud.activity.detected',
        target: { type: 'resource', id: resource.id },
        metadata: { label: resource.name, title: item.title, summary: item.summary },
      });
    }
  }

  private async close(
    trx: TenantTransaction,
    id: string,
    { status, summary }: FinishedRun,
  ): Promise<ActionRunRow | undefined> {
    const row = await trx
      .updateTable('action_runs')
      .set({ status, summary, finished_at: new Date() })
      .where('id', '=', id)
      .where('status', '=', 'running')
      .returningAll()
      .executeTakeFirst();
    if (row) {
      const resource = await trx
        .selectFrom('resources')
        .select('name')
        .where('id', '=', row.resource_id)
        .executeTakeFirst();
      const email = row.started_by_email;
      await this.audit.record(trx, {
        tenantId: row.tenant_id,
        action: row.permission ? AUDIT_ACTIONS[status] : `cloud.activity.${status}`,
        ...(email && {
          actor: row.started_by_user_id ? { userId: row.started_by_user_id, email } : { email },
        }),
        target: { type: 'resource', id: row.resource_id },
        metadata: { label: resource?.name, permission: row.permission, summary },
      });
    }
    return row;
  }
}
