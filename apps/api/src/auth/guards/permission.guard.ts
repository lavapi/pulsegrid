import type { UserPermission } from '@pulsegrid/shared';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditService } from '../../audit/audit.service';
import { TenantDatabase } from '../../database/tenant-database';
import type { AuthContext } from '../session/auth-context';
import type { AuthenticatedRequest } from './authenticated-request';
import { REQUIRE_OWNER } from './require-owner.decorator';
import { REQUIRED_PERMISSIONS } from './require-permission.decorator';

const isAllowed = (auth: AuthContext, ownerOnly: boolean, anyOf: readonly UserPermission[]): boolean =>
  ownerOnly ? auth.isOwner : anyOf.some((permission) => auth.permissions.has(permission));

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const anyOf = this.reflector.getAllAndOverride<UserPermission[] | undefined>(REQUIRED_PERMISSIONS, targets);
    const ownerOnly = Boolean(this.reflector.getAllAndOverride<boolean>(REQUIRE_OWNER, targets));
    if (!anyOf && !ownerOnly) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const { auth, person } = request;
    if (ownerOnly && person?.isOwner) {
      return true;
    }
    if (auth && isAllowed(auth, ownerOnly, anyOf ?? [])) {
      return true;
    }

    if (auth) {
      await this.database.run(auth.tenantId, (trx) =>
        this.audit.record(trx, {
          tenantId: auth.tenantId,
          action: 'access.denied',
          actor: { userId: auth.userId, email: auth.email },
          ipAddress: request.ip,
          metadata: {
            path: request.path,
            required: ownerOnly ? 'owner' : anyOf,
            role: auth.roleName,
          },
        }),
      );
    }
    throw new ForbiddenException('You do not have permission to do that.');
  }
}
