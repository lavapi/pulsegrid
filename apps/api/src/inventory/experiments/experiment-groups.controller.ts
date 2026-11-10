import type { ExperimentGroup } from '@pulsegrid/shared';
import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { RUN_PERMISSION } from './experiment-access';
import { ExperimentGroupsService } from './experiment-groups.service';
import { CHANGE_LIMIT, groupSchema, INVALID_GROUP } from './experiment-schemas';

type GroupBody = z.infer<typeof groupSchema>;

@Controller('cloud/accounts/:id/experiment-groups')
@RequirePermission(RUN_PERMISSION)
@UseGuards(ThrottlerGuard)
@Throttle(CHANGE_LIMIT)
export class ExperimentGroupsController {
  constructor(private readonly groups: ExperimentGroupsService) {}

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(groupSchema, INVALID_GROUP)) body: GroupBody,
    @Req() request: Request,
  ): Promise<ExperimentGroup> {
    return this.groups.create(auth, id, body, request.ip);
  }

  @Put(':groupId')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodPipe(groupSchema, INVALID_GROUP)) body: GroupBody,
    @Req() request: Request,
  ): Promise<ExperimentGroup> {
    return this.groups.update(auth, id, groupId, body, request.ip);
  }

  @Delete(':groupId')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.groups.remove(auth, id, groupId, request.ip);
  }
}
