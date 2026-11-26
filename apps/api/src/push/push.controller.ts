import { Body, Controller, Delete, ForbiddenException, HttpCode, Put, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';
import { AllowNoProject } from '../auth/guards/allow-no-project.decorator';
import { CurrentPerson } from '../auth/guards/current-person.decorator';
import type { PersonContext } from '../auth/session/auth-context';
import { ZodPipe } from '../common/zod.pipe';
import { PushDevicesStore } from './push-devices.store';

const LIMIT = { default: { limit: 10, ttl: 60_000 } };
const ONLY_APP = 'Notifications are turned on from the iPhone app.';

const deviceSchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64,200}$/),
  environment: z.enum(['sandbox', 'production']),
});

/** The iPhone app registers its phone for notifications, tied to its own sign-in. */
@Controller('devices/push')
@AllowNoProject()
@UseGuards(ThrottlerGuard)
@Throttle(LIMIT)
export class PushController {
  constructor(private readonly devices: PushDevicesStore) {}

  @Put()
  @HttpCode(204)
  async register(
    @CurrentPerson() person: PersonContext,
    @Body(new ZodPipe(deviceSchema, ONLY_APP)) body: z.infer<typeof deviceSchema>,
  ): Promise<void> {
    if (person.client !== 'ios') throw new ForbiddenException(ONLY_APP);
    await this.devices.register(person.accountId, person.sessionId, body.token, body.environment);
  }

  @Delete()
  @HttpCode(204)
  async unregister(@CurrentPerson() person: PersonContext): Promise<void> {
    await this.devices.unregister(person.sessionId);
  }
}
