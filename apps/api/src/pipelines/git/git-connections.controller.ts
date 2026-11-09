import type { GitAccessCheck, GitConnection } from '@pulsegrid/shared';
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
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../../auth/guards/current-auth.decorator';
import { RequirePermission } from '../../auth/guards/require-permission.decorator';
import type { AuthContext } from '../../auth/session/auth-context';
import { ZodPipe } from '../../common/zod.pipe';
import { GitConnectionsService } from './git-connections.service';

const credentials = z.record(z.string().max(200), z.string().max(4000));
const organization = z.string().trim().regex(/^[\w.-]+$/).max(200);

const replaceSchema = z.object({ credentials });
const checkSchema = replaceSchema.extend({ provider: z.string().max(40), organization });
const connectionSchema = checkSchema.extend({ name: z.string().trim().min(1).max(100) });

const INVALID_CONNECTION = 'Enter a name, an organization and your credentials.';

@Controller('git/connections')
export class GitConnectionsController {
  constructor(private readonly connections: GitConnectionsService) {}

  @Get()
  @RequirePermission('integrations.manage')
  list(@CurrentAuth() auth: AuthContext): Promise<GitConnection[]> {
    return this.connections.list(auth.tenantId);
  }

  @Post('check')
  @RequirePermission('integrations.manage')
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  check(
    @Body(new ZodPipe(checkSchema, INVALID_CONNECTION)) body: z.infer<typeof checkSchema>,
  ): Promise<GitAccessCheck> {
    return this.connections.checkCredentials(body.provider, body.organization, body.credentials);
  }

  @Post()
  @RequirePermission('integrations.manage')
  @UseGuards(ThrottlerGuard)
  add(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(connectionSchema, INVALID_CONNECTION)) body: z.infer<typeof connectionSchema>,
    @Req() request: Request,
  ): Promise<GitConnection> {
    return this.connections.add(auth, body, request.ip);
  }

  @Put(':id/credentials')
  @RequirePermission('integrations.manage')
  @UseGuards(ThrottlerGuard)
  replaceCredentials(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(replaceSchema, INVALID_CONNECTION)) body: z.infer<typeof replaceSchema>,
    @Req() request: Request,
  ): Promise<GitConnection> {
    return this.connections.replaceCredentials(auth, id, body.credentials, request.ip);
  }

  @Post(':id/test')
  @RequirePermission('integrations.manage')
  @HttpCode(200)
  test(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GitConnection> {
    return this.connections.testConnection(auth, id);
  }

  @Delete(':id')
  @RequirePermission('integrations.manage')
  @HttpCode(204)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    return this.connections.remove(auth, id, request.ip);
  }
}
