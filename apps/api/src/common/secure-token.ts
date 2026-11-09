import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;

export const newToken = (): string => randomBytes(TOKEN_BYTES).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');
