import type {
  PipelineActivity,
  PipelineApp,
  PipelineAppDetail,
  PipelineAppsOverview,
  RepositoryChoice,
} from '@pulsegrid/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PipelineAppsService } from './pipeline-apps.service';
import { pipelineScopeSchema, repositorySchema } from './pipeline-requests';

const INVALID_APP = 'Enter an app name of up to 60 characters and choose a repository.';
const MAX_NAME_LENGTH = 60;

const scopeSchema = z.object({ environment: pipelineScopeSchema });
const createSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  connectionId: z.string().uuid(),
  repository: repositorySchema,
});

@Controller('pipelines/apps')
export class PipelineAppsController {
  constructor(private readonly apps: PipelineAppsService) {}

  @Get()
  overview(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(scopeSchema, INVALID_APP)) query: z.infer<typeof scopeSchema>,
  ): Promise<PipelineAppsOverview> {
    return this.apps.overview(auth.tenantId, query.environment);
  }

  @Get('activity')
  activity(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(scopeSchema, INVALID_APP)) query: z.infer<typeof scopeSchema>,
  ): Promise<PipelineActivity> {
    return this.apps.activity(auth.tenantId, query.environment);
  }

  @Get('repositories')
  @RequirePermission('pipeline_apps.manage')
  repositories(@CurrentAuth() auth: AuthContext): Promise<RepositoryChoice[]> {
    return this.apps.availableRepositories(auth.tenantId);
  }

  @Get(':id')
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(scopeSchema, INVALID_APP)) query: z.infer<typeof scopeSchema>,
  ): Promise<PipelineAppDetail> {
    return this.apps.detail(auth.tenantId, id, query.environment);
  }

  @Post()
  @RequirePermission('pipeline_apps.manage')
  @UseGuards(ThrottlerGuard)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createSchema, INVALID_APP)) body: z.infer<typeof createSchema>,
    @Req() request: Request,
  ): Promise<PipelineApp> {
    return this.apps.create(auth, body, request.ip);
  }

  @Delete(':id')
  @RequirePermission('pipeline_apps.manage')
  @UseGuards(ThrottlerGuard)
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.apps.remove(auth, id, request.ip);
  }
}
