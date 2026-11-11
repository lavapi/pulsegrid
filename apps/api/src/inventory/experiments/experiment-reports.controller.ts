import { RUN_RESULTS, type ExperimentReport, type RunResult, type TestHistory } from '@pulsegrid/shared';
import { Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { CHANGE_LIMIT, READ_LIMIT } from './experiment-schemas';
import { type HistoryQuery, ExperimentReportsService } from './experiment-reports.service';

const INVALID_FILTER = 'Those history filters are not valid.';
const DAY_MS = 24 * 60 * 60 * 1000;

const day = z.iso.date().transform((value) => new Date(`${value}T00:00:00.000Z`));

const historySchema = z
  .object({
    account: z.uuid(),
    label: z.string().trim().min(1).max(200).optional(),
    result: z.enum(RUN_RESULTS as [RunResult, ...RunResult[]]).optional(),
    from: day.optional(),
    to: day.transform((value) => new Date(value.getTime() + DAY_MS)).optional(),
  })
  .transform((query): HistoryQuery => query);

@Controller('experiment-reports')
@UseGuards(ThrottlerGuard)
export class ExperimentReportsController {
  constructor(private readonly reports: ExperimentReportsService) {}

  @Get()
  @Throttle(READ_LIMIT)
  history(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(historySchema, INVALID_FILTER)) query: HistoryQuery,
  ): Promise<TestHistory> {
    return this.reports.history(auth, query);
  }

  @Get('export')
  @Throttle(READ_LIMIT)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="failover-tests.csv"')
  export(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(historySchema, INVALID_FILTER)) query: HistoryQuery,
  ): Promise<string> {
    return this.reports.csv(auth, query);
  }

  @Delete('runs/:runId')
  @RequirePermission('environments.manage')
  @Throttle(CHANGE_LIMIT)
  @HttpCode(204)
  removeRun(
    @CurrentAuth() auth: AuthContext,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.reports.removeRun(auth, runId, request.ip);
  }

  @Get(':id')
  @Throttle(READ_LIMIT)
  report(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<ExperimentReport> {
    return this.reports.report(auth, id);
  }

  @Delete(':id')
  @RequirePermission('environments.manage')
  @Throttle(CHANGE_LIMIT)
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.reports.remove(auth, id, request.ip);
  }
}
