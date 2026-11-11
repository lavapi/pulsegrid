import {
  LOAD_RANGES,
  LOAD_WINDOW_MAX_MINUTES,
  loadRange,
  type ResourceLoad,
  windowPeriodSeconds,
} from '@pulsegrid/shared';
import { Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import type { MetricQuery } from '../providers/provider';
import { ResourceLoadService } from './resource-load.service';

const READ_LIMIT = { default: { limit: 60, ttl: 60_000 } };
const INVALID_RANGE = 'Choose a time range for the load.';
const MS_PER_MINUTE = 60_000;

const RANGE_IDS = LOAD_RANGES.map(({ id }) => id) as [string, ...string[]];

const rangeQuery = z.strictObject({ range: z.enum(RANGE_IDS).default('1h') }).transform(({ range }): MetricQuery => {
  const { minutes, periodSeconds } = loadRange(range) ?? LOAD_RANGES[0];
  const until = new Date();
  return { since: new Date(until.getTime() - minutes * MS_PER_MINUTE), until, periodSeconds };
});

const windowQuery = z
  .object({ from: z.iso.datetime().pipe(z.coerce.date()), to: z.iso.datetime().pipe(z.coerce.date()) })
  .refine(({ from, to }) => from < to && to.getTime() - from.getTime() <= LOAD_WINDOW_MAX_MINUTES * MS_PER_MINUTE)
  .transform(({ from, to }): MetricQuery => ({ since: from, until: to, periodSeconds: windowPeriodSeconds(from, to) }));

const loadSchema = z.union([windowQuery, rangeQuery]);

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
    @Query(new ZodPipe(loadSchema, INVALID_RANGE)) query: MetricQuery,
  ): Promise<ResourceLoad> {
    return this.load.read(auth, id, query);
  }
}
