import type { AccountSettings, TwoFactorEnabled, TwoFactorSetup } from '@pulsegrid/shared';
import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { AccountService } from './account.service';
import { AllowPendingPassword } from './guards/allow-pending-password.decorator';
import { AllowPendingTwoFactor } from './guards/allow-pending-two-factor.decorator';
import { AllowNoProject } from './guards/allow-no-project.decorator';
import { CurrentPerson } from './guards/current-person.decorator';
import { INVALID_PASSWORD, passwordSchema } from './requests';
import type { PersonContext } from './session/auth-context';

const SENSITIVE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: passwordSchema,
});
const newPasswordSchema = z.object({ newPassword: passwordSchema });
const codeSchema = z.object({ code: z.string().trim().min(6).max(12) });
const INVALID_CODE = 'Enter the code from your authenticator app.';

@Controller('account')
@AllowNoProject()
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @AllowPendingTwoFactor()
  @Get()
  settings(@CurrentPerson() auth: PersonContext): Promise<AccountSettings> {
    return this.account.settings(auth);
  }

  @Put('password')
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_LIMIT)
  @HttpCode(204)
  changePassword(
    @CurrentPerson() auth: PersonContext,
    @Body(new ZodPipe(changePasswordSchema, INVALID_PASSWORD))
    body: z.infer<typeof changePasswordSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.account.changePassword(auth, body.currentPassword, body.newPassword, request.ip);
  }

  @AllowPendingPassword()
  @AllowPendingTwoFactor()
  @Post('password/temporary')
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_LIMIT)
  @HttpCode(204)
  replaceTemporaryPassword(
    @CurrentPerson() auth: PersonContext,
    @Body(new ZodPipe(newPasswordSchema, INVALID_PASSWORD)) body: z.infer<typeof newPasswordSchema>,
    @Req() request: Request,
  ): Promise<void> {
    return this.account.replaceTemporaryPassword(auth, body.newPassword, request.ip);
  }

  @AllowPendingTwoFactor()
  @Post('two-factor/start')
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_LIMIT)
  startTwoFactor(@CurrentPerson() auth: PersonContext): Promise<TwoFactorSetup> {
    return this.account.startTwoFactor(auth);
  }

  @AllowPendingTwoFactor()
  @Post('two-factor/confirm')
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_LIMIT)
  confirmTwoFactor(
    @CurrentPerson() auth: PersonContext,
    @Body(new ZodPipe(codeSchema, INVALID_CODE)) body: z.infer<typeof codeSchema>,
    @Req() request: Request,
  ): Promise<TwoFactorEnabled> {
    return this.account.confirmTwoFactor(auth, body.code, request.ip);
  }

  @Post('sign-out-others')
  @HttpCode(204)
  signOutOthers(@CurrentPerson() auth: PersonContext, @Req() request: Request): Promise<void> {
    return this.account.signOutOthers(auth, request.ip);
  }
}
