import type { DatabaseAccessRequest, MyDatabaseAccess } from '@pulsegrid/shared';
import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { DatabaseAccessRequestsService } from './database-access-requests.service';

const CHANGE_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const READ_LIMIT = { default: { limit: 120, ttl: 60_000 } };
const INVALID = 'Check the details and try again.';
const APPROVER = 'production.database_access.grant';

const hours = z.coerce.number().int();
const requestSchema = z.object({
  userName: z.string().trim().min(1, 'Enter your Identity Center user name.').max(128),
  hours,
  reason: z.string().trim().min(1, 'Say what you need to look at.').max(500),
});
const approveSchema = z.object({
  hours,
  code: z.string().trim().min(6, 'Enter the code from your authenticator app.').max(20),
});
const declineSchema = z.object({ reason: z.string().trim().max(500).nullable().default(null) });

/** Asking for database access without the grant permission, and approvers answering. */
@Controller('database-access')
@UseGuards(ThrottlerGuard)
export class DatabaseAccessRequestsController {
  constructor(private readonly requests: DatabaseAccessRequestsService) {}

  @Get('mine')
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  mine(@CurrentAuth() auth: AuthContext): Promise<MyDatabaseAccess> {
    return this.requests.mine(auth);
  }

  @Post('requests')
  @Throttle(CHANGE_LIMIT)
  request(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(requestSchema, INVALID)) body: z.infer<typeof requestSchema>,
    @Req() request: Request,
  ): Promise<DatabaseAccessRequest> {
    return this.requests.request(auth, body, request.ip);
  }

  @Post('requests/:id/cancel')
  @Throttle(CHANGE_LIMIT)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<DatabaseAccessRequest> {
    return this.requests.cancel(auth, id, request.ip);
  }

  @Get('requests')
  @RequirePermission(APPROVER)
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  pending(@CurrentAuth() auth: AuthContext): Promise<DatabaseAccessRequest[]> {
    return this.requests.pending(auth);
  }

  @Get('requests/waiting')
  @RequirePermission(APPROVER)
  @Header('Cache-Control', 'no-store')
  @Throttle(READ_LIMIT)
  async waiting(@CurrentAuth() auth: AuthContext): Promise<{ count: number }> {
    return { count: (await this.requests.pending(auth)).length };
  }

  @Post('requests/:id/approve')
  @RequirePermission(APPROVER)
  @Throttle(CHANGE_LIMIT)
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(approveSchema, INVALID)) body: z.infer<typeof approveSchema>,
    @Req() request: Request,
  ): Promise<DatabaseAccessRequest> {
    return this.requests.approve(auth, id, body, request.ip);
  }

  @Post('requests/:id/decline')
  @RequirePermission(APPROVER)
  @Throttle(CHANGE_LIMIT)
  decline(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(declineSchema, INVALID)) body: z.infer<typeof declineSchema>,
    @Req() request: Request,
  ): Promise<DatabaseAccessRequest> {
    return this.requests.decline(auth, id, body, request.ip);
  }
}
