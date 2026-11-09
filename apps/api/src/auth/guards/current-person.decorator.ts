import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PersonContext } from '../session/auth-context';
import type { AuthenticatedRequest } from './authenticated-request';

export const CurrentPerson = createParamDecorator(
  (_: unknown, context: ExecutionContext): PersonContext => {
    const { person } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!person) {
      throw new Error('CurrentPerson used on a route without a session.');
    }
    return person;
  },
);
