import { LOAD_RANGES, loadRange, type ResourceLoad } from '@pulsegrid/shared';
import { Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { ResourceLoadService } from './resource-load.service';

const READ_LIMIT = { default: { limit: 60, ttl: 60_000 } };
const INVALID_RANGE = 'Choose a time range for the load.';

const RANGE_IDS = LOAD_RANGES.map(({ id }) => id) as [string, ...string[]];
const loadSchema = z.object({ range: z.enum(RANGE_IDS).default('1h') });

@Controller('resources/:id/load')
export class ResourceLoadController {
  constructor(private readonly load: ResourceLoadService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle(READ_LIMIT)
  read(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(loadSchema, INVALID_RANGE)) query: z.infer<typeof loadSchema>,
  ): Promise<ResourceLoad> {
    return this.load.read(auth, id, loadRange(query.range) ?? LOAD_RANGES[0]);
  }
}
