import { describe, expect, it } from 'vitest';
import { TokenCipher } from './token-cipher';

const cipher = new TokenCipher(Buffer.alloc(32, 1));

describe('TokenCipher', () => {
  it('round-trips a value without exposing it', () => {
    const encrypted = cipher.encrypt({ refreshToken: 'secret-value' }, 'user-1');
    expect(Buffer.from(encrypted, 'base64').toString()).not.toContain('secret-value');
    expect(cipher.decrypt(encrypted, 'user-1')).toEqual({ refreshToken: 'secret-value' });
  });

  it('refuses a value encrypted for another user', () => {
    const encrypted = cipher.encrypt({ refreshToken: 'secret' }, 'user-1');
    expect(() => cipher.decrypt(encrypted, 'user-2')).toThrow();
  });

  it('refuses tampered data and the wrong key', () => {
    const encrypted = Buffer.from(cipher.encrypt({ value: 1 }, 'user-1'), 'base64');
    encrypted[encrypted.length - 1]! ^= 1;
    expect(() => cipher.decrypt(encrypted.toString('base64'), 'user-1')).toThrow();
    const good = cipher.encrypt({ value: 1 }, 'user-1');
    expect(() => new TokenCipher(Buffer.alloc(32, 2)).decrypt(good, 'user-1')).toThrow();
  });
});
