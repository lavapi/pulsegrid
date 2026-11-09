import type { ReleaseChoices, ReleasesOverview } from '@pulsegrid/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { ReleasesService } from './releases.service';

const INVALID_TARGET = 'Choose a pipeline and a service.';
const linkSchema = z.object({
  appId: z.string().uuid(),
  workflowId: z.string().regex(/^[\w-]{1,100}$/),
  accountId: z.string().uuid(),
  nativeId: z.string().min(1).max(500),
});

@Controller('releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  overview(@CurrentAuth() auth: AuthContext): Promise<ReleasesOverview> {
    return this.releases.overview(auth.tenantId);
  }

  @Get('choices')
  @RequirePermission('pipeline_apps.manage')
  choices(@CurrentAuth() auth: AuthContext): Promise<ReleaseChoices> {
    return this.releases.choices(auth.tenantId);
  }

  @Post('targets')
  @RequirePermission('pipeline_apps.manage')
  @HttpCode(204)
  link(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(linkSchema, INVALID_TARGET)) body: z.infer<typeof linkSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.releases.link(auth, body, request.ip);
  }

  @Delete('targets/:id')
  @RequirePermission('pipeline_apps.manage')
  @HttpCode(204)
  unlink(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.releases.unlink(auth, id, request.ip);
  }
}
