import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { NOTIFICATION_TOPIC_LIST, type NotificationSettings, type NotificationTopic } from '@pulsegrid/shared';
import { z } from 'zod';
import { AllowNoProject } from '../auth/guards/allow-no-project.decorator';
import { CurrentPerson } from '../auth/guards/current-person.decorator';
import type { PersonContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { NotificationSettingsStore } from './notification-settings.store';

const LIMIT = { default: { limit: 30, ttl: 60_000 } };

const changesSchema = z.strictObject(
  Object.fromEntries(NOTIFICATION_TOPIC_LIST.map((topic) => [topic, z.boolean().optional()])) as Record<
    NotificationTopic,
    z.ZodOptional<z.ZodBoolean>
  >,
);

/** The signed-in person's choice of push notifications, from the app or the web. */
@Controller('account/notifications')
@AllowNoProject()
@UseGuards(ThrottlerGuard)
@Throttle(LIMIT)
export class NotificationSettingsController {
  constructor(private readonly settings: NotificationSettingsStore) {}

  @Get()
  get(@CurrentPerson() person: PersonContext): Promise<NotificationSettings> {
    return this.settings.get(person.accountId);
  }

  @Put()
  update(
    @CurrentPerson() person: PersonContext,
    @Body(new ZodPipe(changesSchema, 'Choose which notifications to turn on or off.')) changes: z.infer<typeof changesSchema>,
  ): Promise<NotificationSettings> {
    const defined = Object.fromEntries(Object.entries(changes).filter(([, on]) => on !== undefined)) as Partial<NotificationSettings>;
    return this.settings.update(person.accountId, defined);
  }
}
