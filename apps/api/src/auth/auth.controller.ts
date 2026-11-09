import type { AuthMethods, CurrentUser, SignInResult } from '@pulsegrid/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { TenantDatabase } from '../database/tenant-database';
import { TenantsService } from '../tenants/tenants.service';
import { AuthService, type SignInOutcome } from './auth.service';
import { GoogleSignInService } from './google/google-sign-in.service';
import { AllowNoProject } from './guards/allow-no-project.decorator';
import { AllowPendingPassword } from './guards/allow-pending-password.decorator';
import { AllowPendingTwoFactor } from './guards/allow-pending-two-factor.decorator';
import { CurrentPerson } from './guards/current-person.decorator';
import { Public } from './guards/public.decorator';
import { emailSchema, INVALID_PASSWORD, nameSchema, passwordSchema } from './requests';
import type { PersonContext } from './session/auth-context';
import { encodeSessionCookie, SESSION_COOKIE } from './session/session-cookie';
import { SessionService } from './session/session.service';
import { SetupService } from './setup.service';

const SENSITIVE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

const setupCodeSchema = z.object({ code: z.string().trim().min(1).max(100) });
const setupSchema = setupCodeSchema.extend({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  company: nameSchema,
});
const signInSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });
const twoFactorSchema = z.object({
  challenge: z.string().min(1).max(100),
  code: z.string().trim().min(6).max(12),
});

const INVALID_SETUP = `Enter your name, company and a valid email. ${INVALID_PASSWORD}`;
const INVALID_SETUP_CODE = 'Enter the setup code from the server logs.';
const INVALID_SIGN_IN = 'Enter your email and password.';
const INVALID_CODE = 'Enter the code from your authenticator app.';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleSignInService,
    private readonly setup: SetupService,
    private readonly tenants: TenantsService,
    private readonly database: TenantDatabase,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('auth/methods')
  async methods(): Promise<AuthMethods> {
    return {
      google: this.google.isEnabled(),
      setupRequired: await this.setup.isRequired(),
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_LIMIT)
  @HttpCode(204)
  @Post('auth/setup/check')
  checkSetupCode(
    @Body(new ZodPipe(setupCodeSchema, INVALID_SETUP_CODE)) body: z.infer<typeof setupCodeSchema>,
  ): Promise<void> {
    return this.setup.checkCode(body.code);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_LIMIT)
  @HttpCode(200)
  @Post('auth/setup')
  async install(
    @Body(new ZodPipe(setupSchema, INVALID_SETUP)) body: z.infer<typeof setupSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResult> {
    const { code, ...workspace } = body;
    return this.respond(await this.setup.install(code, workspace, request.ip), response);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_LIMIT)
  @HttpCode(200)
  @Post('auth/sign-in')
  async signIn(
    @Body(new ZodPipe(signInSchema, INVALID_SIGN_IN)) body: z.infer<typeof signInSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResult> {
    const outcome = await this.auth.signIn(body.email, body.password, request.ip);
    return this.respond(outcome, response);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle(SENSITIVE_LIMIT)
  @HttpCode(200)
  @Post('auth/two-factor')
  async twoFactor(
    @Body(new ZodPipe(twoFactorSchema, INVALID_CODE)) body: z.infer<typeof twoFactorSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SignInResult> {
    const session = await this.auth.completeTwoFactor(body.challenge, body.code, request.ip);
    this.setCookie(response, session);
    return { twoFactorChallenge: null };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Get('auth/google')
  async startGoogle(@Res() response: Response): Promise<void> {
    const url = await this.google.start();
    response.redirect(url ?? '/login?error=google_failed');
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Get('auth/google/callback')
  async finishGoogle(
    @Query('state') state: unknown,
    @Query('code') code: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (typeof state !== 'string' || typeof code !== 'string') {
      response.redirect('/login?error=google_failed');
      return;
    }
    const result = await this.google.finish(state, code, request.ip);
    if (result.kind === 'failed') {
      response.redirect(`/login?error=${result.error}`);
      return;
    }
    const { twoFactorChallenge } = this.respond(result.outcome, response);
    response.redirect(twoFactorChallenge ? `/login?challenge=${twoFactorChallenge}` : '/');
  }

  @AllowPendingPassword()
  @AllowPendingTwoFactor()
  @AllowNoProject()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(
    @CurrentPerson() person: PersonContext,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.sessions.revoke(person.sessionId);
    if (person.project) {
      const { tenantId, userId } = person.project;
      await this.database.run(tenantId, (trx) =>
        this.audit.record(trx, {
          tenantId,
          action: 'auth.signed_out',
          actor: { userId, email: person.email },
          ipAddress: request.ip,
        }),
      );
    }
    response.clearCookie(SESSION_COOKIE, this.cookieOptions());
  }

  @AllowPendingPassword()
  @AllowPendingTwoFactor()
  @AllowNoProject()
  @Get('me')
  async me(@CurrentPerson() person: PersonContext): Promise<CurrentUser> {
    const { project } = person;
    const tenant = project && (await this.tenants.findById(project.tenantId));
    return {
      id: project?.userId ?? person.accountId,
      email: person.email,
      displayName: person.displayName,
      roleName: project?.roleName ?? '',
      permissions: project ? [...project.permissions] : [],
      isOwner: person.isOwner,
      mustChangePassword: person.mustChangePassword,
      twoFactorEnabled: person.twoFactorEnabled,
      tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name } : null,
    };
  }

  private respond(outcome: SignInOutcome, response: Response): SignInResult {
    if (outcome.session) {
      this.setCookie(response, outcome.session);
    }
    return { twoFactorChallenge: outcome.twoFactorChallenge ?? null };
  }

  private setCookie(response: Response, session: string): void {
    response.cookie(SESSION_COOKIE, encodeSessionCookie(session), {
      ...this.cookieOptions(),
      maxAge: this.config.sessionTtlMs,
    });
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.publicUrl.startsWith('https://'),
      path: '/',
    } as const;
  }
}
