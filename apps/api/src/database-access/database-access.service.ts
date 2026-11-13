import {
  DATABASE_ACCESS_LOCAL_PORT,
  DATABASE_ACCESS_MAX_HOURS,
  type DatabaseAccessConnect,
  type DatabaseAccessGrant,
  type DatabaseAccessView,
  type ExtendDatabaseAccessInput,
  type GrantDatabaseAccessInput,
  type RevokeDatabaseAccessInput,
} from '@pulsegrid/shared';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import { FreshCodeCheck } from '../auth/two-factor/fresh-code';
import { TenantDatabase } from '../database/tenant-database';
import { DatabaseAccessError, readable } from './database-access-errors';
import { DatabaseAccessOutside } from './database-access-outside';
import { DatabaseAccessTenants } from './database-access-tenants';
import { DatabaseAccessQueue, type WorkflowKind } from './database-access.queue';
import {
  DATABASE_ACCESS_SETUP,
  type DatabaseAccessSettings,
  type DatabaseAccessSetup,
} from './database-access.settings';
import { DatabaseAccessStore, type GrantRow, toGrant } from './database-access.store';

const MS_PER_HOUR = 3_600_000;
const MIN_EXTENSION_MS = 60_000;
const NOT_HERE = "Database access isn't available in this project.";
const ONLY_ACTIVE = 'Only active access can be changed.';
const AT_MOST = `Access can last at most ${DATABASE_ACCESS_MAX_HOURS} hours from now.`;

const hoursIn = (hours: number): number => {
  if (!Number.isInteger(hours) || hours < 1 || hours > DATABASE_ACCESS_MAX_HOURS) {
    throw new BadRequestException(`Choose between 1 and ${DATABASE_ACCESS_MAX_HOURS} hours.`);
  }
  return hours;
};

const connectOf = ({ connect, accountId, region }: DatabaseAccessSettings): DatabaseAccessConnect | null =>
  connect && { ...connect, accountId, region, localPort: DATABASE_ACCESS_LOCAL_PORT };

/** Grants, extensions and revokes asked for on the page. The AWS workflows do the work; the worker follows them. */
@Injectable()
export class DatabaseAccessService {
  constructor(
    @Inject(DATABASE_ACCESS_SETUP) private readonly setup: DatabaseAccessSetup,
    private readonly store: DatabaseAccessStore,
    private readonly queue: DatabaseAccessQueue,
    private readonly tenants: DatabaseAccessTenants,
    private readonly outside: DatabaseAccessOutside,
    private readonly codes: FreshCodeCheck,
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  async view(auth: AuthContext): Promise<DatabaseAccessView> {
    if (!this.setup.ready) {
      return { ready: false, problems: this.setup.problems };
    }
    const settings = this.setup.settings;
    if (!(await this.tenants.owns(auth.tenantId))) {
      return {
        ready: false,
        problems: [`Connect AWS account ${settings.accountId} to this project to grant access to it.`],
      };
    }
    const [grants, outside] = await Promise.all([this.store.open(auth.tenantId), this.outside.read(auth.tenantId)]);
    return {
      ready: true,
      maxHours: DATABASE_ACCESS_MAX_HOURS,
      grants: grants.map(toGrant),
      outside: outside?.items ?? [],
      outsideCheckedAt: outside?.checkedAt ?? null,
      connect: connectOf(settings),
      missingConnect: settings.missingConnect,
    };
  }

  async history(auth: AuthContext): Promise<DatabaseAccessGrant[]> {
    await this.ready(auth);
    return (await this.store.history(auth.tenantId)).map(toGrant);
  }

  async grant(
    auth: AuthContext,
    input: GrantDatabaseAccessInput,
    ipAddress: string | undefined,
  ): Promise<DatabaseAccessGrant> {
    await this.ready(auth);
    const hours = hoursIn(input.hours);
    await this.codes.confirm(auth.accountId, input.code);
    const row = await this.store.create(auth.tenantId, {
      grantedByUserId: auth.userId,
      grantedByEmail: auth.email,
      userName: input.userName.trim(),
      reason: input.reason.trim(),
      expiresAt: new Date(Date.now() + hours * MS_PER_HOUR),
    });
    try {
      const workflows = await this.tenants.workflows(auth.tenantId);
      await this.started(auth, row, 'grant', await workflows.startGrant(row.user_name, row.expires_at));
    } catch (error) {
      await this.store.grantFailed(auth.tenantId, row.id, readable(error).message);
      throw this.toHttp(error);
    }
    await this.record(auth, row, 'database_access.grant_requested', ipAddress, { hours, reason: row.reason });
    return toGrant(row);
  }

  async extend(
    auth: AuthContext,
    id: string,
    input: ExtendDatabaseAccessInput,
    ipAddress: string | undefined,
  ): Promise<DatabaseAccessGrant> {
    await this.ready(auth);
    const hours = hoursIn(input.hours);
    const grant = await this.active(auth, id);
    const latest = Date.now() + DATABASE_ACCESS_MAX_HOURS * MS_PER_HOUR;
    const expiresAt = new Date(Math.min(grant.expires_at.getTime() + hours * MS_PER_HOUR, latest));
    if (expiresAt.getTime() - grant.expires_at.getTime() < MIN_EXTENSION_MS) {
      throw new BadRequestException(AT_MOST);
    }
    await this.codes.confirm(auth.accountId, input.code);
    await this.change(auth, grant, 'extend', expiresAt);
    await this.record(auth, grant, 'database_access.extend_requested', ipAddress, {
      expiresAt: expiresAt.toISOString(),
    });
    return toGrant(await this.store.get(auth.tenantId, id));
  }

  async revoke(
    auth: AuthContext,
    id: string,
    input: RevokeDatabaseAccessInput,
    ipAddress: string | undefined,
  ): Promise<DatabaseAccessGrant> {
    await this.ready(auth);
    const grant = await this.active(auth, id);
    await this.codes.confirm(auth.accountId, input.code);
    await this.change(auth, grant, 'revoke', null);
    await this.record(auth, grant, 'database_access.revoke_requested', ipAddress, {});
    return toGrant(await this.store.get(auth.tenantId, id));
  }

  /** Marks the change, starts its workflow, and has the worker follow it; undoes the mark when AWS won't start it. */
  private async change(
    auth: AuthContext,
    grant: GrantRow,
    kind: Exclude<WorkflowKind, 'grant'>,
    expiresAt: Date | null,
  ) {
    await this.store.startChange(
      auth.tenantId,
      grant.id,
      kind === 'extend' ? 'extending' : 'revoking',
      auth.email,
      expiresAt,
    );
    try {
      const workflows = await this.tenants.workflows(auth.tenantId);
      const executionArn =
        kind === 'extend' && expiresAt
          ? await workflows.startGrant(grant.user_name, expiresAt)
          : await workflows.startRevoke(grant.user_name);
      await this.started(auth, grant, kind, executionArn);
    } catch (error) {
      await this.store.changeFailed(auth.tenantId, grant.id, readable(error).message);
      throw this.toHttp(error);
    }
  }

  private async started(auth: AuthContext, grant: GrantRow, kind: WorkflowKind, executionArn: string): Promise<void> {
    await this.store.setExecution(auth.tenantId, grant.id, executionArn);
    await this.queue.follow({ tenantId: auth.tenantId, grantId: grant.id, kind });
  }

  private async ready(auth: AuthContext): Promise<void> {
    if (!this.setup.ready || !(await this.tenants.owns(auth.tenantId))) {
      throw new NotFoundException(NOT_HERE);
    }
  }

  private async active(auth: AuthContext, id: string): Promise<GrantRow> {
    const grant = await this.store.get(auth.tenantId, id);
    if (grant.status !== 'active') {
      throw new ConflictException(ONLY_ACTIVE);
    }
    return grant;
  }

  /** A readable failure as an HTTP error the page shows; anything else passes on unchanged. */
  private toHttp(error: unknown): unknown {
    return error instanceof DatabaseAccessError ? new ConflictException(error.message) : error;
  }

  private record(
    auth: AuthContext,
    grant: GrantRow,
    action: string,
    ipAddress: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.database.run(auth.tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId: auth.tenantId,
        action,
        actor: { userId: auth.userId, email: auth.email },
        target: { type: 'database-access', id: grant.id },
        ipAddress,
        metadata: { label: grant.user_name, ...metadata },
      }),
    );
  }
}
