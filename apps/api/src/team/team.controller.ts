import type { Team } from '@pulsegrid/shared';
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
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequireOwner } from '../auth/guards/require-owner.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { TeamService } from './team.service';

const roleIdSchema = z.string().uuid();
const assignSchema = z.object({ accountId: z.string().uuid(), roleId: roleIdSchema });
const changeRoleSchema = z.object({ roleId: roleIdSchema });
const INVALID_ROLE = 'Choose a valid role.';

@Controller()
export class TeamController {
  constructor(
    private readonly team: TeamService,
  ) {}

  @Get('team')
  @RequirePermission('team.view')
  list(@CurrentAuth() auth: AuthContext): Promise<Team> {
    return this.team.team(auth.tenantId);
  }

  @Post('team/assignments')
  @RequireOwner()
  @HttpCode(204)
  assign(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(assignSchema, INVALID_ROLE)) body: z.infer<typeof assignSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.team.assign(auth, body, request.ip);
  }

  @Put('team/members/:id')
  @RequireOwner()
  @HttpCode(204)
  changeRole(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(changeRoleSchema, INVALID_ROLE)) body: z.infer<typeof changeRoleSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.team.changeRole(auth, id, body.roleId, request.ip);
  }

  @Delete('team/members/:id')
  @RequireOwner()
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.team.remove(auth, id, request.ip);
  }
}
