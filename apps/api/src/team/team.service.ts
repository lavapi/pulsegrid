import type { MemberAssignment, Team } from '@pulsegrid/shared';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import { SessionService } from '../auth/session/session.service';
import { isUniqueViolation } from '../database/errors';
import type { TenantTransaction } from '../database/tenant-context';
import { TenantDatabase } from '../database/tenant-database';
import { PeopleService } from './people.service';

const MEMBER_MISSING = 'That person is no longer in this project.';
const ALREADY_MEMBER = 'That person is already in this project.';
const SUPER_ADMIN_PROTECTED = 'The super admin always has full access.';
const ROLE_MISSING = 'That role no longer exists.';
const NOT_YOURSELF = "You can't remove yourself.";

@Injectable()
export class TeamService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly people: PeopleService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  team(tenantId: string): Promise<Team> {
    return this.database.run(tenantId, async (trx) => {
      const members = await trx
        .selectFrom('users')
        .innerJoin('roles', 'roles.id', 'users.role_id')
        .innerJoin('accounts', 'accounts.id', 'users.account_id')
        .selectAll('users')
        .select(['roles.name as role_name', 'accounts.is_super_admin'])
        .orderBy('users.email')
        .execute();
      return {
        members: members.map((member) => ({
          id: member.id,
          email: member.email,
          displayName: member.display_name,
          roleId: member.role_id,
          roleName: member.role_name,
          isOwner: member.is_super_admin,
          lastLoginAt: member.last_login_at.toISOString(),
        })),
      };
    });
  }

  async assign(auth: AuthContext, { accountId, roleId }: MemberAssignment, ipAddress: string | undefined): Promise<void> {
    const account = await this.people.find(accountId);
    try {
      await this.database.run(auth.tenantId, async (trx) => {
        const role = await this.findRole(trx, roleId);
        const member = await trx
          .insertInto('users')
          .values({
            tenant_id: auth.tenantId,
            account_id: account.id,
            role_id: roleId,
            email: account.email,
            display_name: account.display_name,
            last_login_at: new Date(),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await this.record(trx, auth, 'team.member_added', member.id, ipAddress, {
          label: account.email,
          role: role.name,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(ALREADY_MEMBER);
      }
      throw error;
    }
  }

  changeRole(auth: AuthContext, id: string, roleId: string, ipAddress: string | undefined): Promise<void> {
    return this.database.run(auth.tenantId, async (trx) => {
      const member = await this.findMember(trx, id);
      const [from, to] = [await this.findRole(trx, member.role_id), await this.findRole(trx, roleId)];
      await trx.updateTable('users').set({ role_id: roleId }).where('id', '=', id).execute();
      await this.record(trx, auth, 'team.role_changed', id, ipAddress, {
        label: member.email,
        from: from.name,
        to: to.name,
      });
    });
  }

  async remove(auth: AuthContext, id: string, ipAddress: string | undefined): Promise<void> {
    if (id === auth.userId) {
      throw new ConflictException(NOT_YOURSELF);
    }
    const member = await this.database.run(auth.tenantId, async (trx) => {
      const found = await this.findMember(trx, id);
      await trx.deleteFrom('users').where('id', '=', id).execute();
      await this.record(trx, auth, 'team.member_removed', id, ipAddress, { label: found.email });
      return found;
    });
    await this.sessions.leaveProject(member.account_id, auth.tenantId);
  }

  private async findRole(trx: TenantTransaction, id: string) {
    const role = await trx.selectFrom('roles').select('name').where('id', '=', id).executeTakeFirst();
    if (!role) {
      throw new NotFoundException(ROLE_MISSING);
    }
    return role;
  }

  private async findMember(trx: TenantTransaction, id: string) {
    const member = await trx
      .selectFrom('users')
      .innerJoin('accounts', 'accounts.id', 'users.account_id')
      .selectAll('users')
      .select('accounts.is_super_admin')
      .where('users.id', '=', id)
      .executeTakeFirst();
    if (!member) {
      throw new NotFoundException(MEMBER_MISSING);
    }
    if (member.is_super_admin) {
      throw new ConflictException(SUPER_ADMIN_PROTECTED);
    }
    return member;
  }

  private record(
    trx: TenantTransaction,
    auth: AuthContext,
    action: string,
    targetId: string,
    ipAddress: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'team', id: targetId },
      ipAddress,
      metadata,
    });
  }
}
