import {
  type ApproveDatabaseAccessRequestInput,
  DATABASE_ACCESS_MAX_HOURS,
  type DatabaseAccessRequest,
  type DeclineDatabaseAccessRequestInput,
  type MyDatabaseAccess,
  type MyDatabaseAccessHistoryEntry,
  type RequestDatabaseAccessInput,
} from '@pulsegrid/shared';
import { ConflictException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import { FreshCodeCheck } from '../auth/two-factor/fresh-code';
import { TenantDatabase } from '../database/tenant-database';
import { PushNotifier } from '../push/push-notifier';
import { DatabaseAccessRequestsStore, type RequestRow, toRequest } from './database-access-requests.store';
import { DatabaseAccessService, hoursIn } from './database-access.service';
import { DatabaseAccessStore, HISTORY_SIZE, toGrant } from './database-access.store';

const NOT_HERE = 'Database access is requested in the project that has the Production account connected.';
const HAS_ACCESS = 'You already have database access. Ask an approver to extend it.';
const ANSWERED = 'Someone already answered this request.';
const NOT_WAITING = 'This request is no longer waiting.';
const APPROVER = 'production.database_access.grant';

const hoursText = (hours: number): string => `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

/** Requests from people who can't grant access, and approvers' answers. Approving runs an ordinary grant. */
@Injectable()
export class DatabaseAccessRequestsService {
  constructor(
    private readonly requests: DatabaseAccessRequestsStore,
    private readonly grants: DatabaseAccessStore,
    private readonly access: DatabaseAccessService,
    private readonly codes: FreshCodeCheck,
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
    private readonly push: PushNotifier,
  ) {}

  async mine(auth: AuthContext): Promise<MyDatabaseAccess> {
    if (!(await this.access.isReady(auth))) {
      return { ready: false, message: NOT_HERE };
    }
    const request = await this.requests.latestFor(auth.tenantId, auth.userId);
    const grant = request?.grant_id ? await this.grants.find(auth.tenantId, request.grant_id) : undefined;
    return {
      ready: true,
      maxHours: DATABASE_ACCESS_MAX_HOURS,
      suggestedUserName: auth.email,
      request: request ? toRequest(request) : null,
      grant: grant ? toGrant(grant) : null,
      connect: this.access.connect(),
    };
  }

  /** The person's own requests with the grants they led to, newest first. */
  async myHistory(auth: AuthContext): Promise<MyDatabaseAccessHistoryEntry[]> {
    await this.access.requireReady(auth);
    const requests = await this.requests.historyFor(auth.tenantId, auth.userId, HISTORY_SIZE);
    const grantIds = requests.flatMap(({ grant_id }) => (grant_id ? [grant_id] : []));
    const grantRows = await this.grants.findMany(auth.tenantId, grantIds);
    const grants = new Map(grantRows.map((grant) => [grant.id, grant]));
    return requests.map((request) => {
      const grant = request.grant_id ? grants.get(request.grant_id) : undefined;
      return { request: toRequest(request), grant: grant ? toGrant(grant) : null };
    });
  }

  async request(
    auth: AuthContext,
    input: RequestDatabaseAccessInput,
    ipAddress: string | undefined,
  ): Promise<DatabaseAccessRequest> {
    await this.access.requireReady(auth);
    const userName = input.userName.trim();
    if (await this.grants.openFor(auth.tenantId, userName)) {
      throw new ConflictException(HAS_ACCESS);
    }
    const row = await this.requests.create(auth.tenantId, {
      requestedByUserId: auth.userId,
      requestedByEmail: auth.email,
      requestedByName: auth.displayName,
      userName,
      hours: hoursIn(input.hours),
      reason: input.reason.trim(),
    });
    await this.record(auth, row, 'database_access.access_requested', ipAddress, { hours: row.hours, reason: row.reason });
    this.push.toPermission(auth.tenantId, APPROVER, 'database_access', {
      title: 'Database access request',
      body: `${row.requested_by_name} asks for ${hoursText(row.hours)}: ${row.reason}`,
      path: '/settings/database-access',
      collapseId: `db-request-${row.id}`,
    });
    return toRequest(row);
  }

  async cancel(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<DatabaseAccessRequest> {
    const row = await this.requests.get(auth.tenantId, id);
    if (!(await this.requests.cancel(auth.tenantId, id, auth.userId))) {
      throw new ConflictException(NOT_WAITING);
    }
    await this.record(auth, row, 'database_access.request_cancelled', ipAddress, {});
    return toRequest(await this.requests.get(auth.tenantId, id));
  }

  /** Waiting requests; none in a project where access can't be granted, so the dashboard can always ask. */
  async pending(auth: AuthContext): Promise<DatabaseAccessRequest[]> {
    if (!(await this.access.isReady(auth))) {
      return [];
    }
    return (await this.requests.pending(auth.tenantId)).map(toRequest);
  }

  async approve(
    auth: AuthContext,
    id: string,
    input: ApproveDatabaseAccessRequestInput,
    ipAddress: string | undefined,
  ): Promise<DatabaseAccessRequest> {
    await this.access.requireReady(auth);
    const hours = hoursIn(input.hours);
    const row = await this.requests.get(auth.tenantId, id);
    await this.codes.confirm(auth.accountId, input.code);
    if (!(await this.requests.approve(auth.tenantId, id, auth.email))) {
      throw new ConflictException(ANSWERED);
    }
    try {
      const grant = await this.access.start(auth, { userName: row.user_name, reason: row.reason, hours }, ipAddress);
      await this.requests.linkGrant(auth.tenantId, id, grant.id);
    } catch (error) {
      await this.requests.reopen(auth.tenantId, id);
      throw error;
    }
    await this.record(auth, row, 'database_access.request_approved', ipAddress, { hours });
    this.push.toUser(auth.tenantId, row.requested_by_user_id, 'database_access', {
      title: 'Database access approved',
      body: `${auth.email} approved ${hoursText(hours)}. It's ready to use in a minute or two.`,
      path: '/database-access',
      collapseId: `db-request-${row.id}`,
    });
    return toRequest(await this.requests.get(auth.tenantId, id));
  }

  async decline(
    auth: AuthContext,
    id: string,
    input: DeclineDatabaseAccessRequestInput,
    ipAddress: string | undefined,
  ): Promise<DatabaseAccessRequest> {
    await this.access.requireReady(auth);
    const row = await this.requests.get(auth.tenantId, id);
    const reason = input.reason?.trim() || null;
    if (!(await this.requests.decline(auth.tenantId, id, auth.email, reason))) {
      throw new ConflictException(ANSWERED);
    }
    await this.record(auth, row, 'database_access.request_declined', ipAddress, { reason });
    this.push.toUser(auth.tenantId, row.requested_by_user_id, 'database_access', {
      title: 'Database access declined',
      body: reason ? `${auth.email} declined: ${reason}` : `${auth.email} declined your request.`,
      path: '/database-access',
      collapseId: `db-request-${row.id}`,
    });
    return toRequest(await this.requests.get(auth.tenantId, id));
  }

  private record(
    auth: AuthContext,
    request: RequestRow,
    action: string,
    ipAddress: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.database.run(auth.tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId: auth.tenantId,
        action,
        actor: { userId: auth.userId, email: auth.email },
        target: { type: 'database-access-request', id: request.id },
        ipAddress,
        metadata: { label: request.user_name, ...metadata },
      }),
    );
  }
}
