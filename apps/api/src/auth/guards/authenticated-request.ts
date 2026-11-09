import type { Request } from 'express';
import type { AuthContext, PersonContext } from '../session/auth-context';

export interface AuthenticatedRequest extends Request {
  person?: PersonContext;
  auth?: AuthContext;
}
