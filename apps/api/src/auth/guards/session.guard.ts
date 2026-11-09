import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NO_PROJECT } from '@pulsegrid/shared';
import { projectAuth } from '../session/auth-context';
import { decodeSessionCookie, SESSION_COOKIE } from '../session/session-cookie';
import { SessionService } from '../session/session.service';
import type { AuthenticatedRequest } from './authenticated-request';
import { ALLOW_NO_PROJECT } from './allow-no-project.decorator';
import { ALLOW_PENDING_PASSWORD } from './allow-pending-password.decorator';
import { ALLOW_PENDING_TWO_FACTOR } from './allow-pending-two-factor.decorator';
import { IS_PUBLIC } from './public.decorator';

const SIGNED_OUT_MESSAGE = 'Your session has ended. Please sign in again.';
const TWO_FACTOR_MESSAGE = 'Turn on two-factor authentication to continue.';
const PASSWORD_MESSAGE = 'Choose a new password to continue.';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = decodeSessionCookie(request.cookies?.[SESSION_COOKIE]);
    const person = token && (await this.sessions.resolve(token));
    if (!person) {
      throw new UnauthorizedException(SIGNED_OUT_MESSAGE);
    }

    request.person = person;
    request.auth = projectAuth(person) ?? undefined;
    const allows = (key: string) => this.reflector.getAllAndOverride<boolean>(key, targets);
    if (person.mustChangePassword && !allows(ALLOW_PENDING_PASSWORD)) {
      throw new ForbiddenException(PASSWORD_MESSAGE);
    }
    if (!person.twoFactorEnabled && !allows(ALLOW_PENDING_TWO_FACTOR)) {
      throw new ForbiddenException(TWO_FACTOR_MESSAGE);
    }
    if (!request.auth && !allows(ALLOW_NO_PROJECT)) {
      throw new ForbiddenException(NO_PROJECT);
    }
    return true;
  }
}
