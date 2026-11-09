import {
  CLOUD_SERVICES,
  type CloudService,
  type EnvironmentAdminView,
  type EnvironmentComparison,
  type EnvironmentSummary,
  type HealthCounts,
  type ManagedEnvironment,
  type ResourceHealth,
} from '@pulsegrid/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../../auth/session/auth-context';
import { isUniqueViolation } from '../../database/errors';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import {
  type ComparableResource,
  COMPARED_TYPES,
  compareResources,
} from './environment-comparison';
import { detectEnvironment } from './environment-detection';
import { domainsByEnvironment } from './environment-domains';

const NOT_FOUND = 'That environment no longer exists.';
const DUPLICATE_NAME = 'An environment with that name already exists.';

const emptyHealth = (): HealthCounts => ({
  healthy: 0,
  degraded: 0,
  stopped: 0,
  unknown: 0,
  total: 0,
});

const addHealth = (counts: HealthCounts, health: ResourceHealth, amount: number): void => {
  counts[health] += amount;
  counts.total += amount;
};

@Injectable()
export class EnvironmentsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  list({ tenantId }: AuthContext): Promise<EnvironmentSummary[]> {
    return this.database.run(tenantId, async (trx) => {
      await this.assignDetectedAccounts(trx, tenantId);
      return this.summaries(trx);
    });
  }

  get({ tenantId }: AuthContext, id: string): Promise<EnvironmentSummary> {
    return this.database.run(tenantId, async (trx) => {
      await this.assignDetectedAccounts(trx, tenantId);
      const environment = (await this.summaries(trx)).find((item) => item.id === id);
      if (!environment) {
        throw new NotFoundException(NOT_FOUND);
      }
      return environment;
    });
  }

  compare(
    { tenantId }: AuthContext,
    leftId: string,
    rightId: string,
  ): Promise<EnvironmentComparison> {
    return this.database.run(tenantId, async (trx) => {
      await this.assignDetectedAccounts(trx, tenantId);
      const summaries = await this.summaries(trx);
      const find = (id: string): ManagedEnvironment => {
        const environment = summaries.find((item) => item.id === id);
        if (!environment) {
          throw new NotFoundException(NOT_FOUND);
        }
        return { id: environment.id, name: environment.name };
      };
      const [left, right] = [find(leftId), find(rightId)];
      const [leftResources, rightResources] = [
        await this.comparableResources(trx, left.id),
        await this.comparableResources(trx, right.id),
      ];
      return {
        left,
        right,
        rows: compareResources(leftResources, rightResources, [left.name, right.name]),
      };
    });
  }

  adminView(tenantId: string): Promise<EnvironmentAdminView> {
    return this.database.run(tenantId, async (trx) => {
      await this.assignDetectedAccounts(trx, tenantId);
      const [environments, accounts, domains] = await Promise.all([
        trx
          .selectFrom('environments')
          .select(['id', 'name'])
          .orderBy('sort_order')
          .orderBy('name')
          .execute(),
        trx
          .selectFrom('cloud_accounts')
          .select(['id', 'account_id', 'name', 'environment_id'])
          .orderBy('name')
          .execute(),
        domainsByEnvironment(trx),
      ]);
      return {
        environments: environments.map((environment) => ({
          ...environment,
          domains: domains.get(environment.id) ?? [],
        })),
        accounts: accounts.map((account) => ({
          cloudAccountId: account.id,
          accountId: account.account_id,
          name: account.name,
          environmentId: account.environment_id,
        })),
      };
    });
  }

  async create(
    auth: AuthContext,
    name: string,
    ipAddress: string | undefined,
  ): Promise<ManagedEnvironment> {
    return this.friendlyDuplicates(() =>
      this.database.run(auth.tenantId, async (trx) => {
        const environment = await trx
          .insertInto('environments')
          .values({ tenant_id: auth.tenantId, name })
          .returning(['id', 'name'])
          .executeTakeFirstOrThrow();
        await this.record(trx, auth, 'environment.created', environment, ipAddress);
        return environment;
      }),
    );
  }

  async rename(
    auth: AuthContext,
    id: string,
    name: string,
    ipAddress: string | undefined,
  ): Promise<ManagedEnvironment> {
    return this.friendlyDuplicates(() =>
      this.database.run(auth.tenantId, async (trx) => {
        const environment = await trx
          .updateTable('environments')
          .set({ name })
          .where('id', '=', id)
          .returning(['id', 'name'])
          .executeTakeFirst();
        if (!environment) {
          throw new NotFoundException(NOT_FOUND);
        }
        await this.record(trx, auth, 'environment.renamed', environment, ipAddress);
        return environment;
      }),
    );
  }

  remove(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<void> {
    return this.database.run(auth.tenantId, async (trx) => {
      const environment = await trx
        .deleteFrom('environments')
        .where('id', '=', id)
        .returning(['id', 'name'])
        .executeTakeFirst();
      if (!environment) {
        throw new NotFoundException(NOT_FOUND);
      }
      await this.record(trx, auth, 'environment.removed', environment, ipAddress);
    });
  }

  assign(
    auth: AuthContext,
    cloudAccountId: string,
    environmentId: string | null,
    ipAddress: string | undefined,
  ): Promise<void> {
    return this.database.run(auth.tenantId, async (trx) => {
      let target: ManagedEnvironment | undefined;
      if (environmentId) {
        target = await trx
          .selectFrom('environments')
          .select(['id', 'name'])
          .where('id', '=', environmentId)
          .executeTakeFirst();
        if (!target) {
          throw new NotFoundException(NOT_FOUND);
        }
      }
      const account = await trx
        .updateTable('cloud_accounts')
        .set({ environment_id: environmentId, environment_reviewed: true })
        .where('id', '=', cloudAccountId)
        .returning(['id', 'name'])
        .executeTakeFirst();
      if (!account) {
        throw new NotFoundException('That AWS account no longer exists.');
      }
      await this.audit.record(trx, {
        tenantId: auth.tenantId,
        action: 'environment.account_assigned',
        actor: { userId: auth.userId, email: auth.email },
        target: { type: 'aws_account', id: account.id },
        ipAddress,
        metadata: { label: account.name, environment: target?.name ?? null },
      });
    });
  }

  private async assignDetectedAccounts(trx: TenantTransaction, tenantId: string): Promise<void> {
    const accounts = await trx
      .selectFrom('cloud_accounts')
      .select(['id', 'name'])
      .where('environment_reviewed', '=', false)
      .where('status', '=', 'connected')
      .execute();

    for (const account of accounts) {
      const detected = detectEnvironment(account.name);
      const environmentId = detected
        ? await this.ensureEnvironment(trx, tenantId, detected.name, detected.sortOrder)
        : null;
      await trx
        .updateTable('cloud_accounts')
        .set({ environment_id: environmentId, environment_reviewed: true })
        .where('id', '=', account.id)
        .execute();
    }
  }

  private async ensureEnvironment(
    trx: TenantTransaction,
    tenantId: string,
    name: string,
    sortOrder: number,
  ): Promise<string> {
    await trx
      .insertInto('environments')
      .values({ tenant_id: tenantId, name, sort_order: sortOrder })
      .onConflict((conflict) => conflict.columns(['tenant_id', 'name']).doNothing())
      .execute();
    const { id } = await trx
      .selectFrom('environments')
      .select('id')
      .where('name', '=', name)
      .executeTakeFirstOrThrow();
    return id;
  }

  private async summaries(trx: TenantTransaction): Promise<EnvironmentSummary[]> {
    const accounts = await trx
      .selectFrom('cloud_accounts')
      .innerJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
      .select([
        'environments.id as environment_id',
        'environments.name as environment_name',
        'cloud_accounts.id',
        'cloud_accounts.account_id',
        'cloud_accounts.name',
        'cloud_accounts.last_synced_at',
      ])
      .orderBy('environments.sort_order')
      .orderBy('environments.name')
      .orderBy('cloud_accounts.name')
      .execute();

    const counts = await trx
      .selectFrom('resources')
      .innerJoin('cloud_accounts', 'cloud_accounts.id', 'resources.cloud_account_id')
      .select([
        'cloud_accounts.environment_id',
        'resources.service',
        'resources.health',
        sql<string>`count(*)`.as('count'),
      ])
      .where('cloud_accounts.environment_id', 'is not', null)
      .groupBy(['cloud_accounts.environment_id', 'resources.service', 'resources.health'])
      .execute();

    const domains = await domainsByEnvironment(trx);
    const environments = new Map<string, EnvironmentSummary>();
    for (const account of accounts) {
      const environment = environments.get(account.environment_id) ?? {
        id: account.environment_id,
        name: account.environment_name,
        accounts: [],
        health: emptyHealth(),
        services: [],
        lastSyncedAt: null,
        domains: domains.get(account.environment_id) ?? [],
      };
      environment.accounts.push({
        id: account.id,
        accountId: account.account_id,
        name: account.name,
      });
      const syncedAt = account.last_synced_at?.toISOString() ?? null;
      if (syncedAt && (!environment.lastSyncedAt || syncedAt > environment.lastSyncedAt)) {
        environment.lastSyncedAt = syncedAt;
      }
      environments.set(environment.id, environment);
    }

    for (const row of counts) {
      const environment = row.environment_id ? environments.get(row.environment_id) : undefined;
      if (environment) {
        const amount = Number(row.count);
        addHealth(environment.health, row.health, amount);
        addHealth(this.serviceHealth(environment, row.service as CloudService), row.health, amount);
      }
    }

    const order = Object.keys(CLOUD_SERVICES);
    for (const environment of environments.values()) {
      environment.services.sort((a, b) => order.indexOf(a.service) - order.indexOf(b.service));
    }
    return [...environments.values()];
  }

  private serviceHealth(environment: EnvironmentSummary, service: CloudService): HealthCounts {
    const existing = environment.services.find((item) => item.service === service);
    if (existing) {
      return existing.health;
    }
    const health = emptyHealth();
    environment.services.push({ service, health });
    return health;
  }

  private async comparableResources(
    trx: TenantTransaction,
    environmentId: string,
  ): Promise<ComparableResource[]> {
    return trx
      .selectFrom('resources')
      .innerJoin('cloud_accounts', 'cloud_accounts.id', 'resources.cloud_account_id')
      .select([
        'resources.id',
        'resources.type',
        'resources.name',
        'resources.status',
        'resources.health',
        'resources.details',
      ])
      .where('cloud_accounts.environment_id', '=', environmentId)
      .where('resources.type', 'in', COMPARED_TYPES)
      .execute();
  }

  private async friendlyDuplicates<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(DUPLICATE_NAME);
      }
      throw error;
    }
  }

  private record(
    trx: TenantTransaction,
    auth: AuthContext,
    action: string,
    environment: ManagedEnvironment,
    ipAddress: string | undefined,
  ): Promise<void> {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'environment', id: environment.id },
      ipAddress,
      metadata: { label: environment.name },
    });
  }
}
