import type { CloudActivityPage } from '@pulsegrid/shared';
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { CloudActivityService } from './cloud-activity.service';

const READ_LIMIT = { default: { limit: 30, ttl: 60_000 } };
const INVALID_REQUEST = 'Those filters are not valid.';
const filter = z.string().trim().min(1).max(200).optional();

const querySchema = z.object({
  before: z.coerce.date().optional(),
  actor: filter,
  action: filter,
  resource: filter,
  reads: z.enum(['true', 'false']).default('false'),
});

@Controller('cloud/accounts/:id/activity')
export class CloudActivityController {
  constructor(private readonly activity: CloudActivityService) {}

  @Get()
  @RequirePermission('activity.view')
  @UseGuards(ThrottlerGuard)
  @Throttle(READ_LIMIT)
  read(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(querySchema, INVALID_REQUEST)) query: z.infer<typeof querySchema>,
  ): Promise<CloudActivityPage> {
    const { reads, ...filters } = query;
    return this.activity.read(auth, id, { ...filters, includeReads: reads === 'true' });
  }
}
