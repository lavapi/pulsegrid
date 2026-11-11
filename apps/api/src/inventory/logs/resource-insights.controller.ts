import {
  type ConnectionLogPage,
  DATABASE_LOG_LEVELS,
  type DatabaseLogLevel,
  type DatabaseLogView,
  type RequestLogPage,
  type RequestLogSummary,
  type TopSqlView,
} from '@pulsegrid/shared';
import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { DatabaseActivityService } from './database-activity.service';
import { RequestLogsService } from './request-logs.service';

const READ_LIMIT = { default: { limit: 60, ttl: 60_000 } };
const SUMMARY_LIMIT = { default: { limit: 12, ttl: 60_000 } };
const INVALID_REQUEST = 'That log request is not valid.';
const STATUS = /^([1-5]xx|[1-5]\d\d)$/;
const LEVELS = DATABASE_LOG_LEVELS.map(({ id }) => id) as [DatabaseLogLevel, ...DatabaseLogLevel[]];

const text = z.string().trim().max(200).optional();
const flag = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');
const rangeSchema = z.object({ from: z.iso.datetime(), to: z.iso.datetime(), before: z.string().max(2000).optional() });
const requestSchema = rangeSchema.extend({
  host: text,
  path: text,
  status: z.string().regex(STATUS).optional(),
  service: text,
  userAgent: text,
  minResponseMs: z.coerce.number().min(0).max(600_000).optional(),
  showQuery: flag,
});
const connectionSchema = rangeSchema.extend({ failedOnly: flag });
const topSqlSchema = z.object({ range: z.string().max(8) });
const databaseLogSchema = z.object({
  since: z.coerce.date(),
  level: z.enum(LEVELS).default('problems'),
  search: text,
});

/** Request logs of load balancers, and query activity of databases. */
@Controller('resources/:id')
@UseGuards(ThrottlerGuard)
export class ResourceInsightsController {
  constructor(
    private readonly requests: RequestLogsService,
    private readonly databases: DatabaseActivityService,
  ) {}

  @Get('request-log')
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  requestLog(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(requestSchema, INVALID_REQUEST)) query: z.infer<typeof requestSchema>,
    @Req() request: Request,
  ): Promise<RequestLogPage> {
    return this.requests.requests(auth, id, query, request.ip);
  }

  @Get('request-log/summary')
  @Header('Cache-Control', 'no-store')
  @Throttle(SUMMARY_LIMIT)
  requestSummary(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(requestSchema, INVALID_REQUEST)) query: z.infer<typeof requestSchema>,
    @Req() request: Request,
  ): Promise<RequestLogSummary> {
    return this.requests.summary(auth, id, query, request.ip);
  }

  @Get('connection-log')
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  connectionLog(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(connectionSchema, INVALID_REQUEST)) query: z.infer<typeof connectionSchema>,
    @Req() request: Request,
  ): Promise<ConnectionLogPage> {
    return this.requests.connections(auth, id, query, request.ip);
  }

  @Get('top-sql')
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  topSql(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(topSqlSchema, INVALID_REQUEST)) query: z.infer<typeof topSqlSchema>,
    @Req() request: Request,
  ): Promise<TopSqlView> {
    return this.databases.topSql(auth, id, query.range, request.ip);
  }

  @Get('database-log')
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  databaseLog(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(databaseLogSchema, INVALID_REQUEST)) query: z.infer<typeof databaseLogSchema>,
    @Req() request: Request,
  ): Promise<DatabaseLogView> {
    return this.databases.log(auth, id, query, request.ip);
  }
}
