import type { LogView } from '@pulsegrid/shared';
import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { ResourceLogsService } from './resource-logs.service';

const READ_LIMIT = { default: { limit: 60, ttl: 60_000 } };
const INVALID_REQUEST = 'That log request is not valid.';

const logSchema = z.object({
  since: z.coerce.date(),
  search: z.string().trim().max(200).optional(),
});

@Controller('resources/:id/logs')
export class ResourceLogsController {
  constructor(private readonly logs: ResourceLogsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle(READ_LIMIT)
  read(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(logSchema, INVALID_REQUEST)) query: z.infer<typeof logSchema>,
    @Req() request: Request,
  ): Promise<LogView> {
    return this.logs.read(auth, id, query, request.ip);
  }
}
