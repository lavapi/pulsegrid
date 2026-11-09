import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext } from '../session/auth-context';
import type { AuthenticatedRequest } from './authenticated-request';

export const CurrentAuth = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthContext => {
    const { auth } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!auth) {
      throw new Error('CurrentAuth used on a route without a session.');
    }
    return auth;
  },
);
