import { type ActivityCategory, type AuditEventPage, isActivityCategory } from '@pulsegrid/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { TenantDatabase } from '../database/tenant-database';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { AuditService } from './audit.service';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .regex(/^[1-9]\d{0,18}$/)
    .optional(),
  actor: z.string().max(320).optional(),
  category: z.string().refine(isActivityCategory).optional(),
  account: z.string().uuid().optional(),
  resource: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

@Controller('audit-events')
export class AuditController {
  constructor(
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('activity.view')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(querySchema, 'That page of the audit log does not exist.'))
    query: z.infer<typeof querySchema>,
  ): Promise<AuditEventPage> {
    return this.database.run(auth.tenantId, (trx) =>
      this.audit.list(trx, query.limit, {
        cursor: query.cursor,
        actor: query.actor,
        category: query.category as ActivityCategory | undefined,
        cloudAccountId: query.account,
        resourceId: query.resource,
        from: query.from,
        to: query.to,
      }),
    );
  }

  @Get('actors')
  @RequirePermission('activity.view')
  actors(@CurrentAuth() auth: AuthContext): Promise<string[]> {
    return this.database.run(auth.tenantId, (trx) => this.audit.actors(trx));
  }
}
