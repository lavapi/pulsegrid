import { DATABASE_ACCESS_REQUEST_HOURS, type DatabaseAccessRequest } from '@pulsegrid/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Selectable, Updateable } from 'kysely';
import { isUniqueViolation } from '../database/errors';
import type { DatabaseAccessRequestStatus, DatabaseAccessRequestsTable } from '../database/schema';
import type { TenantTransaction } from '../database/tenant-context';
import { TenantDatabase } from '../database/tenant-database';

export type RequestRow = Selectable<DatabaseAccessRequestsTable>;
type RequestChanges = Updateable<DatabaseAccessRequestsTable>;

const LIFETIME_MS = DATABASE_ACCESS_REQUEST_HOURS * 3_600_000;
const NOT_FOUND = 'That request no longer exists.';
const ALREADY_WAITING = 'You already have a request waiting. Cancel it to ask again.';

export interface NewRequest {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByName: string;
  userName: string;
  hours: number;
  reason: string;
}

export const toRequest = (row: RequestRow): DatabaseAccessRequest => ({
  id: row.id,
  requestedBy: row.requested_by_name,
  requestedByEmail: row.requested_by_email,
  userName: row.user_name,
  hours: row.hours,
  reason: row.reason,
  status: row.status,
  createdAt: row.created_at.toISOString(),
  expiresAt: new Date(row.created_at.getTime() + LIFETIME_MS).toISOString(),
  decidedBy: row.decided_by_email,
  decidedAt: row.decided_at?.toISOString() ?? null,
  declineReason: row.decline_reason,
  grantId: row.grant_id,
});

/** Access requests. Answering one is conditional on it still waiting, so two approvers can't both answer it. */
@Injectable()
export class DatabaseAccessRequestsStore {
  constructor(private readonly database: TenantDatabase) {}

  async create(tenantId: string, request: NewRequest): Promise<RequestRow> {
    try {
      return await this.run(tenantId, (trx) =>
        trx
          .insertInto('database_access_requests')
          .values({
            tenant_id: tenantId,
            requested_by_user_id: request.requestedByUserId,
            requested_by_email: request.requestedByEmail,
            requested_by_name: request.requestedByName,
            user_name: request.userName,
            hours: request.hours,
            reason: request.reason,
            status: 'pending',
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    } catch (error) {
      throw isUniqueViolation(error) ? new ConflictException(ALREADY_WAITING) : error;
    }
  }

  async get(tenantId: string, id: string): Promise<RequestRow> {
    const row = await this.run(tenantId, (trx) =>
      trx.selectFrom('database_access_requests').selectAll().where('id', '=', id).executeTakeFirst(),
    );
    if (!row) {
      throw new NotFoundException(NOT_FOUND);
    }
    return row;
  }

  /** Waiting requests, oldest first. */
  pending(tenantId: string): Promise<RequestRow[]> {
    return this.run(tenantId, (trx) =>
      trx
        .selectFrom('database_access_requests')
        .selectAll()
        .where('status', '=', 'pending')
        .orderBy('created_at')
        .execute(),
    );
  }

  latestFor(tenantId: string, userId: string): Promise<RequestRow | undefined> {
    return this.run(tenantId, (trx) =>
      trx
        .selectFrom('database_access_requests')
        .selectAll()
        .where('requested_by_user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst(),
    );
  }

  /** A person's own requests, newest first. */
  historyFor(tenantId: string, userId: string, limit: number): Promise<RequestRow[]> {
    return this.run(tenantId, (trx) =>
      trx
        .selectFrom('database_access_requests')
        .selectAll()
        .where('requested_by_user_id', '=', userId)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .execute(),
    );
  }

  /** Takes a waiting request for approval; false when someone else answered it first. */
  approve(tenantId: string, id: string, by: string): Promise<boolean> {
    return this.answer(tenantId, id, 'pending', { status: 'approved', decided_by_email: by, decided_at: new Date() });
  }

  /** Puts an approval back when its grant couldn't start, so it can be answered again. */
  async reopen(tenantId: string, id: string): Promise<void> {
    await this.answer(tenantId, id, 'approved', { status: 'pending', decided_by_email: null, decided_at: null });
  }

  async linkGrant(tenantId: string, id: string, grantId: string): Promise<void> {
    await this.answer(tenantId, id, 'approved', { grant_id: grantId });
  }

  decline(tenantId: string, id: string, by: string, reason: string | null): Promise<boolean> {
    return this.answer(tenantId, id, 'pending', {
      status: 'declined',
      decided_by_email: by,
      decided_at: new Date(),
      decline_reason: reason,
    });
  }

  cancel(tenantId: string, id: string, userId: string): Promise<boolean> {
    return this.answer(tenantId, id, 'pending', { status: 'cancelled' }, userId);
  }

  private async answer(
    tenantId: string,
    id: string,
    from: DatabaseAccessRequestStatus,
    changes: RequestChanges,
    requestedBy?: string,
  ): Promise<boolean> {
    const result = await this.run(tenantId, (trx) =>
      trx
        .updateTable('database_access_requests')
        .set({ ...changes, updated_at: new Date() })
        .where('id', '=', id)
        .where('status', '=', from)
        .$if(requestedBy !== undefined, (query) => query.where('requested_by_user_id', '=', requestedBy!))
        .executeTakeFirst(),
    );
    return Number(result.numUpdatedRows) > 0;
  }

  /** Every read and answer first expires requests left unanswered too long, so nobody acts on a stale one. */
  private run<T>(tenantId: string, work: (trx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.database.run(tenantId, async (trx) => {
      await trx
        .updateTable('database_access_requests')
        .set({ status: 'expired', updated_at: new Date() })
        .where('status', '=', 'pending')
        .where('created_at', '<', new Date(Date.now() - LIFETIME_MS))
        .execute();
      return work(trx);
    });
  }
}
