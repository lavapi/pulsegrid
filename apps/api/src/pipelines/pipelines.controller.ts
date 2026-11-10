import type {
  PipelineHistory,
  PipelineRunDetail,
  PipelineSummary,
} from '@pulsegrid/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequireEnvironmentPermission, RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { pipelineScopeSchema as scopeSchema } from './pipeline-requests';
import { PipelinesService } from './pipelines.service';

const INVALID_REQUEST = 'That pipeline request is not valid.';

const app = z.string().uuid();
const pipelineId = z.string().regex(/^[\w-]{1,100}$/);

const historySchema = z.object({ app, workflow: pipelineId, environment: scopeSchema });
const runSchema = z.object({ app, run: pipelineId });

const startRunSchema = z.object({
  appId: app,
  workflowId: pipelineId,
  branch: z.string().min(1).max(255).regex(/^[^\s~^:?*[\\]+$/),
  inputs: z.record(z.string().max(200), z.string().max(2000)).default({}),
});

const runActionSchema = z.object({ appId: app, runId: pipelineId });
const rerunSchema = runActionSchema.extend({ failedOnly: z.boolean().default(false) });

const linkSchema = z.object({
  appId: app,
  workflowId: pipelineId,
  environmentId: z.string().uuid().nullable(),
});

@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelines: PipelinesService) {}

  @Get('history')
  history(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(historySchema, INVALID_REQUEST)) query: z.infer<typeof historySchema>,
  ): Promise<PipelineHistory> {
    return this.pipelines.history(auth, query.app, query.workflow, query.environment);
  }

  @Get('run')
  run(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(runSchema, INVALID_REQUEST)) query: z.infer<typeof runSchema>,
  ): Promise<PipelineRunDetail> {
    return this.pipelines.runDetail(auth, query.app, query.run);
  }

  @Get('environment/:id')
  forEnvironment(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PipelineSummary[]> {
    return this.pipelines.forEnvironment(auth.tenantId, id);
  }

  @Post('runs')
  @RequireEnvironmentPermission('pipeline.run')
  @UseGuards(ThrottlerGuard)
  @HttpCode(202)
  startRun(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(startRunSchema, INVALID_REQUEST)) body: z.infer<typeof startRunSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.pipelines.startRun(auth, body, request.ip);
  }

  @Post('runs/rerun')
  @RequireEnvironmentPermission('pipeline.run')
  @UseGuards(ThrottlerGuard)
  @HttpCode(202)
  rerun(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(rerunSchema, INVALID_REQUEST)) body: z.infer<typeof rerunSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.pipelines.rerun(auth, body, request.ip);
  }

  @Post('runs/cancel')
  @RequireEnvironmentPermission('pipeline.run')
  @UseGuards(ThrottlerGuard)
  @HttpCode(202)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(runActionSchema, INVALID_REQUEST)) body: z.infer<typeof runActionSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.pipelines.cancel(auth, body, request.ip);
  }

  @Put('link')
  @RequirePermission('environments.manage')
  @HttpCode(204)
  link(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(linkSchema, INVALID_REQUEST)) body: z.infer<typeof linkSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.pipelines.link(auth, body.appId, body.workflowId, body.environmentId, request.ip);
  }
}
