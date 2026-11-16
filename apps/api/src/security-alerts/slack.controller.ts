import type { SlackIntegration } from '@pulsegrid/shared';
import {
  BadGatewayException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { TenantDatabase } from '../database/tenant-database';
import { SLACK_WEBHOOK, SlackIntegrations } from './slack-integrations';
import { SlackPoster } from './slack-poster';

const CHANGE_LIMIT = { default: { limit: 10, ttl: 60_000 } };
const webhookSchema = z.object({ webhookUrl: z.string().trim().regex(SLACK_WEBHOOK) });
const INVALID_URL = 'Paste a Slack incoming webhook URL. It starts with https://hooks.slack.com/services/.';
const NOT_CONNECTED = 'Connect Slack first.';
const TEST_FAILED = "Slack didn't accept the test message. Check that the webhook still exists.";
const TEST_MESSAGE = 'PulseGrid is connected. New critical and high AWS security alerts will be posted here.';

/** The Slack channel a project's security alerts are posted to. */
@Controller('integrations/slack')
@RequirePermission('integrations.manage')
@UseGuards(ThrottlerGuard)
@Throttle(CHANGE_LIMIT)
export class SlackController {
  private readonly logger = new Logger(SlackController.name);

  constructor(
    private readonly database: TenantDatabase,
    private readonly slack: SlackIntegrations,
    private readonly poster: SlackPoster,
    private readonly audit: AuditService,
  ) {}

  @Get()
  view(@CurrentAuth() auth: AuthContext): Promise<SlackIntegration> {
    return this.database.run(auth.tenantId, (trx) => this.slack.view(trx));
  }

  @Put()
  save(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(webhookSchema, INVALID_URL)) body: z.infer<typeof webhookSchema>,
    @Req() request: Request,
  ): Promise<SlackIntegration> {
    return this.database.run(auth.tenantId, async (trx) => {
      await this.slack.save(trx, auth.tenantId, body.webhookUrl, auth.email);
      await this.record(trx, auth, 'integration.slack.connected', request.ip);
      return this.slack.view(trx);
    });
  }

  @Delete()
  @HttpCode(204)
  async remove(@CurrentAuth() auth: AuthContext, @Req() request: Request): Promise<void> {
    await this.database.run(auth.tenantId, async (trx) => {
      await this.slack.remove(trx);
      await this.record(trx, auth, 'integration.slack.disconnected', request.ip);
    });
  }

  @Post('test')
  @HttpCode(204)
  async test(@CurrentAuth() auth: AuthContext): Promise<void> {
    const webhookUrl = await this.database.run(auth.tenantId, (trx) => this.slack.webhookUrl(trx, auth.tenantId));
    if (!webhookUrl) {
      throw new NotFoundException(NOT_CONNECTED);
    }
    try {
      await this.poster.send(webhookUrl, TEST_MESSAGE);
    } catch (error) {
      this.logger.warn(`Slack test message failed: ${error instanceof Error ? error.name : 'unknown error'}`);
      throw new BadGatewayException(TEST_FAILED);
    }
  }

  private record(trx: Parameters<AuditService['record']>[0], auth: AuthContext, action: string, ip?: string) {
    return this.audit.record(trx, {
      tenantId: auth.tenantId,
      action,
      actor: { userId: auth.userId, email: auth.email },
      target: { type: 'integration', id: 'slack' },
      ipAddress: ip,
    });
  }
}
