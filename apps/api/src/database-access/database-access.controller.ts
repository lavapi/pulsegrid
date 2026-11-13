import type { DatabaseAccessGrant, DatabaseAccessView } from '@pulsegrid/shared';
import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseAccessService } from './database-access.service';

const CHANGE_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const READ_LIMIT = { default: { limit: 60, ttl: 60_000 } };
const INVALID = 'Check the details and try again.';

const code = z.string().trim().min(6, 'Enter the code from your authenticator app.').max(20);
const hours = z.coerce.number().int();
const grantSchema = z.object({
  userName: z.string().trim().min(1, 'Enter their Identity Center user name.').max(128),
  hours,
  reason: z.string().trim().min(1, 'Give a reason.').max(500),
  code,
});
const extendSchema = z.object({ hours, code });
const revokeSchema = z.object({ code });

/** Read-only access to the production database, for a set time. Every change asks for a fresh code. */
@Controller('database-access')
@RequirePermission('production.database_access.grant')
@UseGuards(ThrottlerGuard)
export class DatabaseAccessController {
  constructor(private readonly access: DatabaseAccessService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  view(@CurrentAuth() auth: AuthContext): Promise<DatabaseAccessView> {
    return this.access.view(auth);
  }

  @Get('history')
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  history(@CurrentAuth() auth: AuthContext): Promise<DatabaseAccessGrant[]> {
    return this.access.history(auth);
  }

  @Post('grants')
  @Throttle(CHANGE_LIMIT)
  grant(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(grantSchema, INVALID)) body: z.infer<typeof grantSchema>,
    @Req() request: Request,
  ): Promise<DatabaseAccessGrant> {
    return this.access.grant(auth, body, request.ip);
  }

  @Post('grants/:id/extend')
  @Throttle(CHANGE_LIMIT)
  extend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(extendSchema, INVALID)) body: z.infer<typeof extendSchema>,
    @Req() request: Request,
  ): Promise<DatabaseAccessGrant> {
    return this.access.extend(auth, id, body, request.ip);
  }

  @Post('grants/:id/revoke')
  @Throttle(CHANGE_LIMIT)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(revokeSchema, INVALID)) body: z.infer<typeof revokeSchema>,
    @Req() request: Request,
  ): Promise<DatabaseAccessGrant> {
    return this.access.revoke(auth, id, body, request.ip);
  }
}
