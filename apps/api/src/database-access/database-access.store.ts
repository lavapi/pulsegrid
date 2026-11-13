import type { DatabaseAccessGrant } from '@pulsegrid/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Selectable, Updateable } from 'kysely';
import { isUniqueViolation } from '../database/errors';
import type {
  DatabaseAccessChange,
  DatabaseAccessEndReason,
  DatabaseAccessGrantsTable,
  DatabaseAccessStatus,
} from '../database/schema';
import { TenantDatabase } from '../database/tenant-database';

export type GrantRow = Selectable<DatabaseAccessGrantsTable>;
type GrantChanges = Updateable<DatabaseAccessGrantsTable>;

const OPEN: DatabaseAccessStatus[] = ['granting', 'active'];
const HISTORY_SIZE = 100;
const NOT_FOUND = 'That grant no longer exists.';
const CHANGE_RUNNING = 'A change to this access is still running. Wait for it to finish.';

export interface NewGrant {
  grantedByUserId: string;
  grantedByEmail: string;
  userName: string;
  reason: string;
  expiresAt: Date;
}

export const toGrant = (row: GrantRow): DatabaseAccessGrant => ({
  id: row.id,
  grantedBy: row.granted_by_email,
  userName: row.user_name,
  userId: row.user_id,
  reason: row.reason,
  status: row.status,
  change: row.change,
  failure: row.failure,
  startsAt: row.starts_at.toISOString(),
  expiresAt: row.expires_at.toISOString(),
  revokedAt: row.revoked_at?.toISOString() ?? null,
  revokedBy: row.revoked_by_email,
  endReason: row.end_reason,
});

/** Grants in the database. Every change is conditional on the current state, so a job that runs twice changes nothing more. */
@Injectable()
export class DatabaseAccessStore {
  constructor(private readonly database: TenantDatabase) {}

  async create(tenantId: string, grant: NewGrant): Promise<GrantRow> {
    try {
      return await this.database.run(tenantId, (trx) =>
        trx
          .insertInto('database_access_grants')
          .values({
            tenant_id: tenantId,
            granted_by_user_id: grant.grantedByUserId,
            granted_by_email: grant.grantedByEmail,
            user_name: grant.userName,
            reason: grant.reason,
            status: 'granting',
            requested_expires_at: grant.expiresAt,
            expires_at: grant.expiresAt,
          })
          .returningAll()
          .executeTakeFirstOrThrow(),
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`${grant.userName} already has database access. Extend it instead.`);
      }
      throw error;
    }
  }

  async get(tenantId: string, id: string): Promise<GrantRow> {
    const row = await this.find(tenantId, id);
    if (!row) {
      throw new NotFoundException(NOT_FOUND);
    }
    return row;
  }

  find(tenantId: string, id: string): Promise<GrantRow | undefined> {
    return this.database.run(tenantId, (trx) =>
      trx.selectFrom('database_access_grants').selectAll().where('id', '=', id).executeTakeFirst(),
    );
  }

  /** Grants in progress and active access, ending soonest first. */
  open(tenantId: string): Promise<GrantRow[]> {
    return this.database.run(tenantId, (trx) =>
      trx.selectFrom('database_access_grants').selectAll().where('status', 'in', OPEN).orderBy('expires_at').execute(),
    );
  }

  history(tenantId: string): Promise<GrantRow[]> {
    return this.database.run(tenantId, (trx) =>
      trx
        .selectFrom('database_access_grants')
        .selectAll()
        .where('status', 'not in', OPEN)
        .orderBy('created_at', 'desc')
        .limit(HISTORY_SIZE)
        .execute(),
    );
  }

  async setExecution(tenantId: string, id: string, executionArn: string): Promise<void> {
    await this.change(tenantId, id, OPEN, { execution_arn: executionArn });
  }

  async granted(tenantId: string, id: string, userId: string, expiresAt: Date): Promise<boolean> {
    return this.change(tenantId, id, ['granting'], {
      status: 'active',
      user_id: userId,
      expires_at: expiresAt,
      requested_expires_at: null,
      execution_arn: null,
      failure: null,
      starts_at: new Date(),
    });
  }

  async grantFailed(tenantId: string, id: string, failure: string): Promise<boolean> {
    return this.change(tenantId, id, ['granting'], { status: 'failed', execution_arn: null, failure });
  }

  /** Marks a change as running on active access; refuses when another change is still running. */
  async startChange(
    tenantId: string,
    id: string,
    change: DatabaseAccessChange,
    by: string,
    requestedExpiresAt: Date | null,
  ): Promise<void> {
    const started = await this.database.run(tenantId, (trx) =>
      trx
        .updateTable('database_access_grants')
        .set({
          change,
          change_by_email: by,
          requested_expires_at: requestedExpiresAt,
          failure: null,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('status', '=', 'active')
        .where('change', 'is', null)
        .executeTakeFirst(),
    );
    if (Number(started.numUpdatedRows) === 0) {
      throw new ConflictException(CHANGE_RUNNING);
    }
  }

  async extended(tenantId: string, id: string, expiresAt: Date): Promise<boolean> {
    return this.change(tenantId, id, ['active'], {
      expires_at: expiresAt,
      change: null,
      change_by_email: null,
      requested_expires_at: null,
      execution_arn: null,
      failure: null,
    });
  }

  async changeFailed(tenantId: string, id: string, failure: string): Promise<boolean> {
    return this.change(tenantId, id, ['active'], {
      change: null,
      change_by_email: null,
      requested_expires_at: null,
      execution_arn: null,
      failure,
    });
  }

  /** Ends active access; true only for the run that ended it, so a second run writes no second audit entry. */
  async ended(
    tenantId: string,
    id: string,
    reason: DatabaseAccessEndReason,
    by: string | null,
    note: string | null = null,
  ): Promise<boolean> {
    return this.change(tenantId, id, ['active'], {
      status: reason === 'manual' ? 'revoked' : 'expired',
      end_reason: reason,
      revoked_at: new Date(),
      revoked_by_email: by,
      change: null,
      change_by_email: null,
      requested_expires_at: null,
      execution_arn: null,
      failure: note,
    });
  }

  private async change(
    tenantId: string,
    id: string,
    from: DatabaseAccessStatus[],
    changes: GrantChanges,
  ): Promise<boolean> {
    const result = await this.database.run(tenantId, (trx) =>
      trx
        .updateTable('database_access_grants')
        .set({ ...changes, updated_at: new Date() })
        .where('id', '=', id)
        .where('status', 'in', from)
        .executeTakeFirst(),
    );
    return Number(result.numUpdatedRows) > 0;
  }
}
