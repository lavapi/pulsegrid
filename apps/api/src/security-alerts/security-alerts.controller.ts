import {
  ALERT_SEVERITIES,
  ALERT_SOURCES,
  ALERT_STATUSES,
  type SecurityAlertDetail,
  type SecurityAlertFilterOptions,
  type SecurityAlertPage,
} from '@pulsegrid/shared';
import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { SecurityAlertsService } from './security-alerts.service';

const blankless = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const querySchema = z.object({
  severity: blankless(z.enum(ALERT_SEVERITIES)),
  source: blankless(z.enum(ALERT_SOURCES)),
  account: blankless(z.string().regex(/^\d{12}$/)),
  region: blankless(z.string().regex(/^[a-z0-9-]{1,30}$/)),
  status: blankless(z.enum(ALERT_STATUSES)),
  from: blankless(z.coerce.date()),
  to: blankless(z.coerce.date()),
  cursor: blankless(z.string().regex(/^[\w-]{1,200}$/)),
});

const statusSchema = z.object({ status: z.enum(ALERT_STATUSES) });

@Controller('security-alerts')
@RequirePermission('security.view')
export class SecurityAlertsController {
  constructor(private readonly alerts: SecurityAlertsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(querySchema, 'Check the filters and try again.')) query: z.infer<typeof querySchema>,
  ): Promise<SecurityAlertPage> {
    return this.alerts.list(auth, { ...query, accountId: query.account });
  }

  @Get('options')
  options(@CurrentAuth() auth: AuthContext): Promise<SecurityAlertFilterOptions> {
    return this.alerts.options(auth);
  }

  @Get('unseen')
  @Header('Cache-Control', 'no-store')
  unseen(@CurrentAuth() auth: AuthContext): Promise<{ count: number }> {
    return this.alerts.unseen(auth);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<SecurityAlertDetail> {
    return this.alerts.detail(auth, id);
  }

  @Post(':id/status')
  @RequirePermission('security.manage')
  changeStatus(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(statusSchema, 'Choose a status.')) body: z.infer<typeof statusSchema>,
    @Req() request: Request,
  ): Promise<SecurityAlertDetail> {
    return this.alerts.changeStatus(auth, id, body.status, request.ip);
  }
}
