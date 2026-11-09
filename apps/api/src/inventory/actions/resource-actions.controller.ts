import { type ActionRun, isCloudPermission, type ResourceActionOption } from '@pulsegrid/shared';
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ResourceActionsService } from './resource-actions.service';

const ACTION_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const UNKNOWN_ACTION = "That action isn't available.";

@Controller('resources/:id/actions')
export class ResourceActionsController {
  constructor(private readonly actions: ResourceActionsService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ResourceActionOption[]> {
    return this.actions.list(auth, id);
  }

  @Get('runs/latest')
  latest(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ActionRun | null> {
    return this.actions.latest(auth, id);
  }

  @Post(':permission')
  @UseGuards(ThrottlerGuard)
  @Throttle(ACTION_LIMIT)
  run(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permission') permission: string,
    @Req() request: Request,
  ): Promise<ActionRun> {
    if (!isCloudPermission(permission)) {
      throw new NotFoundException(UNKNOWN_ACTION);
    }
    return this.actions.run(auth, id, permission, request.ip);
  }
}
