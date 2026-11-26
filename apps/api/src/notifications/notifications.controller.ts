import type { MyNotifications, SlackApp } from '@pulsegrid/shared';
import { Body, Controller, Delete, Get, Header, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentAuth } from '../auth/guards/current-auth.decorator';
import { RequirePermission } from '../auth/guards/require-permission.decorator';
import type { AuthContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationsService } from './notifications.service';

const CHANGE_LIMIT = { default: { limit: 10, ttl: 60_000 } };

const tokenSchema = z.object({ botToken: z.string().trim().regex(/^xoxb-[\w-]{20,250}$/) });
const INVALID_TOKEN = 'Paste the Bot User OAuth Token. It starts with xoxb-.';

const settingsSchema = z.object({
  githubLogin: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/)
    .nullable()
    .or(z.literal('').transform(() => null)),
  prReady: z.boolean(),
  prFailed: z.boolean(),
  deployReady: z.boolean(),
  deployFailed: z.boolean(),
});
const INVALID_SETTINGS = 'Check your GitHub username: letters, numbers and dashes only.';

/** The project's Slack app, which personal messages are sent through. */
@Controller('integrations/slack')
@RequirePermission('integrations.manage')
@UseGuards(ThrottlerGuard)
@Throttle(CHANGE_LIMIT)
export class SlackAppController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  view(@CurrentAuth() auth: AuthContext): Promise<SlackApp> {
    return this.notifications.slackApp(auth);
  }

  @Put()
  connect(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(tokenSchema, INVALID_TOKEN)) body: z.infer<typeof tokenSchema>,
    @Req() request: Request,
  ): Promise<SlackApp> {
    return this.notifications.connectSlack(auth, body.botToken, request.ip);
  }

  @Delete()
  @HttpCode(204)
  disconnect(@CurrentAuth() auth: AuthContext, @Req() request: Request): Promise<void> {
    return this.notifications.disconnectSlack(auth, request.ip);
  }
}

/** Each person's own notifications: anyone in the project can set theirs, and send themselves a test. */
@Controller('notifications/me')
@UseGuards(ThrottlerGuard)
export class MyNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  mine(@CurrentAuth() auth: AuthContext): Promise<MyNotifications> {
    return this.notifications.mine(auth);
  }

  @Put()
  @Throttle(CHANGE_LIMIT)
  save(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(settingsSchema, INVALID_SETTINGS)) body: z.infer<typeof settingsSchema>,
  ): Promise<MyNotifications> {
    return this.notifications.saveMine(auth, body);
  }

  @Post('test')
  @HttpCode(204)
  @Throttle(CHANGE_LIMIT)
  test(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.notifications.testSlack(auth);
  }
}
