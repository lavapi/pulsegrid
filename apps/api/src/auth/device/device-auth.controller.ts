import type { DeviceSignInCode, DeviceToken, SignedInDevice } from '@pulsegrid/shared';
import { Body, Controller, Delete, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../../audit/audit.service';
import { ZodPipe } from '../../common/zod.pipe';
import { TenantDatabase } from '../../database/tenant-database';
import { AllowNoProject } from '../guards/allow-no-project.decorator';
import { CurrentPerson } from '../guards/current-person.decorator';
import { Public } from '../guards/public.decorator';
import type { PersonContext } from '../session/auth-context';
import { SessionService } from '../session/session.service';
import { DeviceSignInService } from './device-sign-in.service';

const LIMIT = { default: { limit: 10, ttl: 60_000 } };
const INVALID = 'Sign in again from the app.';
const GONE = 'That device is already signed out.';

const codeSchema = z.object({
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  deviceName: z.string().trim().min(1).max(60),
});
const tokenSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});

/** Signing in the iPhone app, and the list of phones a person has signed in. */
@Controller()
@UseGuards(ThrottlerGuard)
export class DeviceAuthController {
  constructor(
    private readonly signIn: DeviceSignInService,
    private readonly sessions: SessionService,
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  /** Called by the hand-off page in the browser, with the person's browser sign-in. */
  @AllowNoProject()
  @Post('auth/device/codes')
  @Throttle(LIMIT)
  async code(
    @CurrentPerson() person: PersonContext,
    @Body(new ZodPipe(codeSchema, INVALID)) body: z.infer<typeof codeSchema>,
  ): Promise<DeviceSignInCode> {
    return { code: await this.signIn.createCode(person, body.challenge, body.deviceName) };
  }

  /** Called by the app with the code it was handed and the verifier only it knows. */
  @Public()
  @Post('auth/device/token')
  @Throttle(LIMIT)
  async token(
    @Body(new ZodPipe(tokenSchema, INVALID)) body: z.infer<typeof tokenSchema>,
    @Req() request: Request,
  ): Promise<DeviceToken> {
    const { token, expiresAt, deviceName } = await this.signIn.exchange(body.code, body.verifier);
    const person = await this.sessions.resolve(token);
    if (person?.project) {
      await this.record(person, 'auth.device_signed_in', request.ip, deviceName);
    }
    return { token, expiresAt };
  }

  @AllowNoProject()
  @Get('account/devices')
  @Header('Cache-Control', 'no-store')
  devices(@CurrentPerson() person: PersonContext): Promise<SignedInDevice[]> {
    return this.sessions.devices(person.accountId, person.sessionId);
  }

  @AllowNoProject()
  @Delete('account/devices/:id')
  @HttpCode(204)
  @Throttle(LIMIT)
  async signOut(
    @CurrentPerson() person: PersonContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
  ): Promise<void> {
    const name = (await this.sessions.devices(person.accountId, person.sessionId)).find((device) => device.id === id)?.name;
    if (!name || !(await this.sessions.revokeDevice(person.accountId, id))) {
      throw new NotFoundException(GONE);
    }
    if (person.project) {
      await this.record(person, 'auth.device_signed_out', request.ip, name);
    }
  }

  private record(person: PersonContext, action: string, ipAddress: string | undefined, deviceName: string): Promise<void> {
    const { tenantId, userId } = person.project!;
    return this.database.run(tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId,
        action,
        actor: { userId, email: person.email },
        ipAddress,
        metadata: { label: deviceName },
      }),
    );
  }
}
