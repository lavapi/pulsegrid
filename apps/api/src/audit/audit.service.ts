import { ACTIVITY_CATEGORIES, type ActivityCategory, type AuditEvent, type AuditEventPage } from '@pulsegrid/shared';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { TenantTransaction } from '../database/tenant-context';

export interface AuditEntry {
  tenantId: string;
  action: string;
  actor?: { userId: string; email: string } | { email: string };
  target?: { type: string; id: string };
  ipAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditFilter {
  cursor?: string | undefined;
  actor?: string | undefined;
  category?: ActivityCategory | undefined;
  cloudAccountId?: string | undefined;
  resourceId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

const toAuditEvent = (row: {
  id: string;
  action: string;
  actor_email: string | null;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}, displayNames: ReadonlyMap<string, string>): AuditEvent => ({
  id: row.id,
  action: row.action,
  actorEmail: row.actor_email,
  targetType: row.target_type,
  targetId: row.target_id,
  ipAddress: row.ip_address,
  metadata: row.metadata,
  occurredAt: row.occurred_at.toISOString(),
  targetDisplayName:
    (row.target_type === RESOURCE_TARGET && row.target_id && displayNames.get(row.target_id)) || null,
});

const RESOURCE_TARGET = 'resource';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TargetRow = { target_type: string | null; target_id: string | null };

/** The current display names of the resources events are about, so old entries show today's names. */
const displayNamesOf = async (trx: TenantTransaction, rows: readonly TargetRow[]) => {
  const ids = [
    ...new Set(
      rows.flatMap(({ target_type: type, target_id: id }) =>
        type === RESOURCE_TARGET && id && UUID.test(id) ? [id] : [],
      ),
    ),
  ];
  if (ids.length === 0) {
    return new Map<string, string>();
  }
  const named = await trx
    .selectFrom('resources')
    .innerJoin('resource_display_names', (join) =>
      join
        .onRef('resource_display_names.cloud_account_id', '=', 'resources.cloud_account_id')
        .onRef('resource_display_names.native_id', '=', 'resources.native_id'),
    )
    .select(['resources.id', 'resource_display_names.display_name'])
    .where('resources.id', 'in', ids)
    .execute();
  return new Map(named.map(({ id, display_name: displayName }) => [id, displayName]));
};

@Injectable()
export class AuditService {
  async record(trx: TenantTransaction, entry: AuditEntry): Promise<void> {
    const actorUserId = entry.actor && 'userId' in entry.actor ? entry.actor.userId : null;
    await trx
      .insertInto('audit_events')
      .values({
        tenant_id: entry.tenantId,
        actor_user_id: actorUserId,
        actor_email: entry.actor?.email ?? null,
        action: entry.action,
        target_type: entry.target?.type ?? null,
        target_id: entry.target?.id ?? null,
        ip_address: entry.ipAddress ?? null,
        metadata: JSON.stringify(entry.metadata ?? {}),
      })
      .execute();
  }

  async list(trx: TenantTransaction, limit: number, filter: AuditFilter = {}): Promise<AuditEventPage> {
    const { cursor, actor, category, cloudAccountId, resourceId, from, to } = filter;
    let query = trx
      .selectFrom('audit_events')
      .selectAll()
      .orderBy('id', 'desc')
      .limit(limit + 1);
    if (cursor !== undefined) {
      query = query.where('id', '<', cursor);
    }
    if (actor) {
      query = query.where('actor_email', '=', actor);
    }
    if (category) {
      const { prefixes } = ACTIVITY_CATEGORIES[category];
      query = query.where((eb) => eb.or(prefixes.map((prefix) => eb('action', 'like', `${prefix}%`))));
    }
    if (resourceId) {
      query = query.where('target_type', '=', 'resource').where('target_id', '=', resourceId);
    }
    if (cloudAccountId) {
      query = query.where('target_type', '=', 'resource').where('target_id', 'in', (eb) =>
        eb
          .selectFrom('resources')
          .select(sql<string>`id::text`.as('id'))
          .where('cloud_account_id', '=', cloudAccountId),
      );
    }
    if (from) {
      query = query.where('occurred_at', '>=', from);
    }
    if (to) {
      query = query.where('occurred_at', '<=', to);
    }

    const rows = await query.execute();
    const page = rows.slice(0, limit);
    const displayNames = await displayNamesOf(trx, page);
    return {
      events: page.map((row) => toAuditEvent(row, displayNames)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async actors(trx: TenantTransaction): Promise<string[]> {
    const rows = await trx
      .selectFrom('audit_events')
      .select('actor_email')
      .distinct()
      .where('actor_email', 'is not', null)
      .orderBy('actor_email')
      .execute();
    return rows.flatMap(({ actor_email: email }) => (email ? [email] : []));
  }
}
