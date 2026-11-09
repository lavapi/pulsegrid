import { createHash, randomBytes } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';

const ISSUER = 'PulseGrid';
const PERIOD_SECONDS = 30;
const WINDOW = 1;
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 5;

const totpFor = (secret: string, label: string): TOTP =>
  new TOTP({ issuer: ISSUER, label, period: PERIOD_SECONDS, secret: Secret.fromBase32(secret) });

export const newTotpSecret = (): string => new Secret({ size: 20 }).base32;

export const totpUri = (secret: string, email: string): string =>
  totpFor(secret, email).toString();

export const totpStep = (secret: string, code: string, now = Date.now()): number | null => {
  const delta = totpFor(secret, 'check').validate({ token: code, window: WINDOW, timestamp: now });
  return delta === null ? null : Math.floor(now / 1000 / PERIOD_SECONDS) + delta;
};

export const hashBackupCode = (code: string): string =>
  createHash('sha256').update(code.toLowerCase().replaceAll('-', '')).digest('hex');

export const newBackupCodes = (): string[] =>
  Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const code = randomBytes(BACKUP_CODE_BYTES).toString('hex');
    return `${code.slice(0, 5)}-${code.slice(5)}`;
  });
