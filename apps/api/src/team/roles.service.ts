import type { Role, RoleInput } from '@pulsegrid/shared';
import { isUserPermission } from '@pulsegrid/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import { isUniqueViolation } from '../database/errors';
import type { TenantTransaction } from '../database/tenant-context';
import { TenantDatabase } from '../database/tenant-database';

const ROLE_MISSING = 'That role no longer exists.';
const NAME_TAKEN = 'A role with that name already exists.';
const ROLE_IN_USE = 'Move everyone to another role first.';

@Injectable()
export class RolesService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<Role[]> {
    return this.database.run(tenantId, async (trx) => {
      const roles = await trx.selectFrom('roles').select(['id', 'name']).orderBy('name').execute();
      const grants = await trx.selectFrom('role_permissions').select(['role_id', 'permission']).execute();
      const members = await trx.selectFrom('users').select('role_id').execute();
      return roles.map(({ id, name }) => ({
        id,
        name,
        permissions: grants
          .filter(({ role_id: roleId }) => roleId === id)
          .map(({ permission }) => permission)
          .filter(isUserPermission),
        memberCount: members.filter(({ role_id: roleId }) => roleId === id).length,
      }));
    });
  }

  create(auth: AuthContext, input: RoleInput, ipAddress: string | undefined): Promise<void> {
    return this.saving(() =>
      this.database.run(auth.tenantId, async (trx) => {
        const { id } = await trx
          .insertInto('roles')
          .values({ tenant_id: auth.tenantId, name: input.name })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.setPermissions(trx, auth.tenantId, id, input);
        await this.record(trx, auth, 'team.role_created', id, ipAddress, input);
      }),
    );
  }

  update(auth: AuthContext, id: string, input: RoleInput, ipAddress: string | undefined): Promise<void> {
    return this.saving(() =>
      this.database.run(auth.tenantId, async (trx) => {
        const updated = await trx
          .updateTable('roles')
          .set({ name: input.name })
          .where('id', '=', id)
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) {
          throw new NotFoundException(ROLE_MISSING);
        }
        await trx.deleteFrom('role_permissions').where('role_id', '=', id).execute();
        await this.setPermissions(trx, auth.tenantId, id, input);
        await this.record(trx, auth, 'team.role_updated', id, ipAddress, input);
      }),
    );
  }

  remove(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<void> {
    return this.database.run(auth.tenantId, async (trx) => {
      const role = await trx.selectFrom('roles').select('name').where('id', '=', id).executeTakeFirst();
      if (!role) {
        throw new NotFoundException(ROLE_MISSING);
      }
      const member = await trx.selectFrom('users').select('id').where('role_id', '=', id).executeTakeFirst();
      if (member) {
        throw new ConflictException(ROLE_IN_USE);
      }
      await trx.deleteFrom('roles').where('id', '=', id).execute();
      await this.record(trx, auth, 'team.role_deleted', id, ipAddress, { name: role.name });
    });
  }

  private async saving(save: () => Promise<void>): Promise<void> {
    try {
      await save();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(NAME_TAKEN);
      }
      throw error;
    }
  }

  private async setPermissions(
    trx: TenantTransaction,
    tenantId: string,
    roleId: string,
    { permissions }: RoleInput,
  ): Promise<void> {
    if (permissions.length > 0) {
      await trx
        .insertInto('role_permissions')
        .values(permissions.map((permission) => ({ tenant_id: tenantId, role_id: roleId, permission })))
        .execute();
    }
  }

  private record(
    trx: TenantTransaction,
    auth: AuthContext,
    action: string,
    targetId: string,
    ipAddress: string | undefined,
    { name, permissions }: Partial<RoleInput>,
  ): Promise<void> {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'role', id: targetId },
      ipAddress,
      metadata: { label: name, permissions },
    });
  }
}
