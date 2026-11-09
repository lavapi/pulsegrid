import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { AuthContext } from '../../auth/session/auth-context';
import { TenantDatabase } from '../../database/tenant-database';

const RESOURCE_MISSING = 'That resource no longer exists.';

@Injectable()
export class ResourceAccess {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  load(auth: AuthContext, id: string) {
    return this.database.run(auth.tenantId, async (trx) => {
      const resource = await trx
        .selectFrom('resources')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!resource) {
        throw new NotFoundException(RESOURCE_MISSING);
      }
      const account = await trx
        .selectFrom('cloud_accounts')
        .leftJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
        .selectAll('cloud_accounts')
        .select('environments.name as environment_name')
        .where('cloud_accounts.id', '=', resource.cloud_account_id)
        .executeTakeFirstOrThrow();
      return {
        resource,
        account,
        environmentName: account.environment_name,
        granted: auth.permissions,
      };
    });
  }

  record(
    auth: AuthContext,
    action: string,
    targetId: string,
    ipAddress: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.database.run(auth.tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId: auth.tenantId,
        action,
        actor: { userId: auth.userId, email: auth.email },
        target: { type: 'resource', id: targetId },
        ipAddress,
        metadata,
      }),
    );
  }
}
