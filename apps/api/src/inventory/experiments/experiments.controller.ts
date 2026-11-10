import type { ExperimentDetail, ExperimentsView, StartedExperiment } from '@pulsegrid/shared';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { RUN_PERMISSION } from './experiment-access';
import { ExperimentsService } from './experiments.service';

const READ_LIMIT = { default: { limit: 60, ttl: 60_000 } };
const CHANGE_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const INVALID_REQUEST = 'That experiment request is not valid.';

const region = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d{1,2}$/);
const awsId = z.string().regex(/^[A-Za-z0-9]{1,64}$/);
const experimentSchema = z.object({ region, experimentId: awsId });
const startSchema = z.object({ region, templateId: awsId });

@Controller('cloud/accounts/:id/experiments')
export class ExperimentsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get()
  @UseGuards(ThrottlerGuard)
  @Throttle(READ_LIMIT)
  view(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<ExperimentsView> {
    return this.experiments.view(auth, id);
  }

  @Post()
  @RequirePermission(RUN_PERMISSION)
  @UseGuards(ThrottlerGuard)
  @Throttle(CHANGE_LIMIT)
  start(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(startSchema, INVALID_REQUEST)) body: z.infer<typeof startSchema>,
    @Req() request: Request,
  ): Promise<StartedExperiment> {
    return this.experiments.start(auth, id, body.region, body.templateId, request.ip);
  }

  @Get(':region/:experimentId')
  @UseGuards(ThrottlerGuard)
  @Throttle(READ_LIMIT)
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param(new ZodPipe(experimentSchema.extend({ id: z.string() }), INVALID_REQUEST))
    params: z.infer<typeof experimentSchema>,
  ): Promise<ExperimentDetail> {
    return this.experiments.detail(auth, id, params.region, params.experimentId);
  }

  @Post(':region/:experimentId/stop')
  @RequirePermission(RUN_PERMISSION)
  @UseGuards(ThrottlerGuard)
  @Throttle(CHANGE_LIMIT)
  @HttpCode(204)
  stop(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param(new ZodPipe(experimentSchema.extend({ id: z.string() }), INVALID_REQUEST))
    params: z.infer<typeof experimentSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.experiments.stop(auth, id, params.region, params.experimentId, request.ip);
  }
}
