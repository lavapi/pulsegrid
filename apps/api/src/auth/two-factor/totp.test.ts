import { TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';
import { newBackupCodes, newTotpSecret, totpStep, totpUri } from './totp';

const codeFor = (secret: string, timestamp: number): string =>
  new TOTP({ secret }).generate({ timestamp });

describe('totp', () => {
  const secret = newTotpSecret();
  const now = 1_800_000_000_000;

  it('accepts the current code and the one either side', () => {
    expect(totpStep(secret, codeFor(secret, now), now)).toBe(60_000_000);
    expect(totpStep(secret, codeFor(secret, now - 30_000), now)).toBe(59_999_999);
  });

  it('refuses old and wrong codes', () => {
    expect(totpStep(secret, codeFor(secret, now - 120_000), now)).toBeNull();
    expect(totpStep(secret, '000000', now)).toBeNull();
  });

  it('builds an authenticator link', () => {
    expect(totpUri(secret, 'ada@example.test')).toContain('otpauth://totp/');
  });
});

describe('backup codes', () => {
  it('creates ten different codes', () => {
    expect(new Set(newBackupCodes()).size).toBe(10);
  });
});
