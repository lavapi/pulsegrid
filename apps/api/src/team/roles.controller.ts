import { isUserPermission, type Role, type UserPermission } from '@pulsegrid/shared';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequireOwner } from '../auth/guards/require-owner.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { RolesService } from './roles.service';

const MAX_NAME_LENGTH = 60;
const roleSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  permissions: z
    .array(z.string().refine(isUserPermission))
    .transform((items) => [...new Set(items)] as UserPermission[]),
});

const INVALID_ROLE = 'Enter a role name and choose valid permissions.';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('team.view')
  list(@CurrentAuth() auth: AuthContext): Promise<Role[]> {
    return this.roles.list(auth.tenantId);
  }

  @Post()
  @RequireOwner()
  @HttpCode(204)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(roleSchema, INVALID_ROLE)) body: z.infer<typeof roleSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.roles.create(auth, body, request.ip);
  }

  @Put(':id')
  @RequireOwner()
  @HttpCode(204)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(roleSchema, INVALID_ROLE)) body: z.infer<typeof roleSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.roles.update(auth, id, body, request.ip);
  }

  @Delete(':id')
  @RequireOwner()
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.roles.remove(auth, id, request.ip);
  }
}
