import type { ExperimentGroup, ExperimentGroupInput } from '@pulsegrid/shared';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import { isUniqueViolation } from '../../database/errors';
import type { TenantTransaction } from '../../database/tenant-context';
import { TenantDatabase } from '../../database/tenant-database';
import { type ExperimentTarget, ExperimentGateway } from './experiment-gateway';

const GROUP_MISSING = 'That test group no longer exists.';
const NAME_TAKEN = 'A group with that name already exists.';
const REGION_NOT_SYNCED = "A template is in a region this account doesn't sync.";

export const listGroups = (trx: TenantTransaction, accountId: string): Promise<ExperimentGroup[]> =>
  trx
    .selectFrom('experiment_groups')
    .select(['id', 'name', 'templates'])
    .where('cloud_account_id', '=', accountId)
    .orderBy('name')
    .execute();

export const findGroup = async (
  trx: TenantTransaction,
  accountId: string,
  groupId: string,
): Promise<ExperimentGroup> => {
  const row = await trx
    .selectFrom('experiment_groups')
    .select(['id', 'name', 'templates'])
    .where('cloud_account_id', '=', accountId)
    .where('id', '=', groupId)
    .executeTakeFirst();
  if (!row) {
    throw new NotFoundException(GROUP_MISSING);
  }
  return row;
};

@Injectable()
export class ExperimentGroupsService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly gateway: ExperimentGateway,
  ) {}

  async create(
    auth: AuthContext,
    accountId: string,
    input: ExperimentGroupInput,
    ipAddress: string | undefined,
  ): Promise<ExperimentGroup> {
    const target = await this.allowedTarget(auth, accountId, input, ipAddress);
    const group = await this.saving(() =>
      this.database.run(auth.tenantId, (trx) =>
        trx
          .insertInto('experiment_groups')
          .values({
            tenant_id: auth.tenantId,
            cloud_account_id: accountId,
            name: input.name,
            templates: JSON.stringify(input.templates),
          })
          .returning(['id', 'name', 'templates'])
          .executeTakeFirstOrThrow(),
      ),
    );
    await this.audit(auth, target, 'created', group, ipAddress);
    return group;
  }

  async update(
    auth: AuthContext,
    accountId: string,
    groupId: string,
    input: ExperimentGroupInput,
    ipAddress: string | undefined,
  ): Promise<ExperimentGroup> {
    const target = await this.allowedTarget(auth, accountId, input, ipAddress);
    const group = await this.saving(() =>
      this.database.run(auth.tenantId, async (trx) => {
        await findGroup(trx, accountId, groupId);
        return trx
          .updateTable('experiment_groups')
          .set({ name: input.name, templates: JSON.stringify(input.templates) })
          .where('id', '=', groupId)
          .returning(['id', 'name', 'templates'])
          .executeTakeFirstOrThrow();
      }),
    );
    await this.audit(auth, target, 'updated', group, ipAddress);
    return group;
  }

  async remove(auth: AuthContext, accountId: string, groupId: string, ipAddress: string | undefined): Promise<void> {
    const target = await this.gateway.find(auth, accountId);
    const group = await this.database.run(auth.tenantId, (trx) => findGroup(trx, accountId, groupId));
    await this.authorize(auth, target, group.name, ipAddress);
    await this.database.run(auth.tenantId, (trx) =>
      trx.deleteFrom('experiment_groups').where('id', '=', groupId).execute(),
    );
    await this.audit(auth, target, 'deleted', group, ipAddress);
  }

  private async allowedTarget(
    auth: AuthContext,
    accountId: string,
    input: ExperimentGroupInput,
    ipAddress: string | undefined,
  ): Promise<ExperimentTarget> {
    const target = await this.gateway.find(auth, accountId);
    await this.authorize(auth, target, input.name, ipAddress);
    if (input.templates.some(({ region }) => !target.account.regions.includes(region))) {
      throw new BadRequestException(REGION_NOT_SYNCED);
    }
    return target;
  }

  private authorize(auth: AuthContext, target: ExperimentTarget, name: string, ipAddress: string | undefined) {
    return this.gateway.authorize(auth, target, {
      targetType: 'experiment-group',
      targetId: target.account.id,
      ipAddress,
      metadata: { label: name, cloudAccount: target.account.account_id },
    });
  }

  private async saving<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(NAME_TAKEN);
      }
      throw error;
    }
  }

  private audit(
    auth: AuthContext,
    target: ExperimentTarget,
    change: 'created' | 'updated' | 'deleted',
    group: ExperimentGroup,
    ipAddress: string | undefined,
  ) {
    return this.gateway.record(auth, {
      action: `cloud.experiment-group.${change}`,
      targetType: 'experiment-group',
      targetId: group.id,
      ipAddress,
      metadata: { label: group.name, templates: group.templates.length, cloudAccount: target.account.account_id },
    });
  }
}
