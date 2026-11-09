import type {
  EnvironmentAdminView,
  EnvironmentComparison,
  EnvironmentSummary,
  ManagedEnvironment,
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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { EnvironmentsService } from './environments.service';

const nameSchema = z.object({ name: z.string().trim().min(1).max(60) });
const assignmentSchema = z.object({ environmentId: z.string().uuid().nullable() });
const comparisonSchema = z.object({ left: z.string().uuid(), right: z.string().uuid() });

const INVALID_NAME = 'Enter a name up to 60 characters.';
const INVALID_ASSIGNMENT = 'Choose a valid environment.';
const INVALID_COMPARISON = 'Choose two environments to compare.';

@Controller('environments')
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<EnvironmentSummary[]> {
    return this.environments.list(auth);
  }

  @Get('compare')
  compare(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(comparisonSchema, INVALID_COMPARISON))
    query: z.infer<typeof comparisonSchema>,
  ): Promise<EnvironmentComparison> {
    return this.environments.compare(auth, query.left, query.right);
  }

  @Get('manage')
  @RequirePermission('environments.manage', 'integrations.manage')
  manage(@CurrentAuth() auth: AuthContext): Promise<EnvironmentAdminView> {
    return this.environments.adminView(auth.tenantId);
  }

  @Put('accounts/:cloudAccountId')
  @RequirePermission('environments.manage', 'integrations.manage')
  @HttpCode(204)
  assign(
    @CurrentAuth() auth: AuthContext,
    @Param('cloudAccountId', ParseUUIDPipe) cloudAccountId: string,
    @Body(new ZodPipe(assignmentSchema, INVALID_ASSIGNMENT))
    body: z.infer<typeof assignmentSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.environments.assign(auth, cloudAccountId, body.environmentId, request.ip);
  }

  @Post()
  @RequirePermission('environments.manage')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(nameSchema, INVALID_NAME)) body: z.infer<typeof nameSchema>,
    @Req() request: Request,
  ): Promise<ManagedEnvironment> {
    return this.environments.create(auth, body.name, request.ip);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EnvironmentSummary> {
    return this.environments.get(auth, id);
  }

  @Put(':id')
  @RequirePermission('environments.manage')
  rename(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(nameSchema, INVALID_NAME)) body: z.infer<typeof nameSchema>,
    @Req() request: Request,
  ): Promise<ManagedEnvironment> {
    return this.environments.rename(auth, id, body.name, request.ip);
  }

  @Delete(':id')
  @RequirePermission('environments.manage')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.environments.remove(auth, id, request.ip);
  }
}
