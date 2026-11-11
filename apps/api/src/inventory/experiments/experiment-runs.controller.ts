import type { ExperimentCapacity, ExperimentRunDetail, StartedExperimentRun } from '@pulsegrid/shared';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequireEnvironmentPermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { RUN_PERMISSION } from './experiment-access';
import { ExperimentRunsService } from './experiment-runs.service';
import { CHANGE_LIMIT, INVALID_REQUEST, READ_LIMIT, runSchema } from './experiment-schemas';

@Controller('cloud/accounts/:id/experiment-runs')
@UseGuards(ThrottlerGuard)
export class ExperimentRunsController {
  constructor(private readonly runs: ExperimentRunsService) {}

  @Post()
  @RequireEnvironmentPermission(RUN_PERMISSION)
  @Throttle(CHANGE_LIMIT)
  start(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(runSchema, INVALID_REQUEST)) body: z.infer<typeof runSchema>,
    @Req() request: Request,
  ): Promise<StartedExperimentRun> {
    return this.runs.start(auth, id, body, request.ip);
  }

  @Get('capacity')
  @Throttle(READ_LIMIT)
  capacity(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<ExperimentCapacity[]> {
    return this.runs.capacity(auth, id);
  }

  @Get(':runId')
  @Throttle(READ_LIMIT)
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<ExperimentRunDetail> {
    return this.runs.detail(auth, id, runId);
  }

  @Post(':runId/stop')
  @RequireEnvironmentPermission(RUN_PERMISSION)
  @Throttle(CHANGE_LIMIT)
  @HttpCode(204)
  stop(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.runs.stop(auth, id, runId, request.ip);
  }
}
