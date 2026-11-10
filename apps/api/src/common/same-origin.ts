import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CROSS_SITE = 'This request came from another site, so it was refused.';

/** Refuses changes sent by a browser from another site. Requests without an Origin header, such as scripts, pass. */
export const sameOriginOnly = (publicUrl: string) => {
  const allowed = new URL(publicUrl).origin;
  return (request: Request, response: Response, next: NextFunction): void => {
    const { origin } = request.headers;
    if (SAFE_METHODS.has(request.method) || origin === undefined || origin === allowed) {
      next();
      return;
    }
    response.status(403).json({ message: CROSS_SITE });
  };
};
