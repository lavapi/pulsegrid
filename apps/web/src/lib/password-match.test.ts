import { describe, expect, it } from 'vitest';
import { passwordMismatch } from './password-match';

describe('passwordMismatch', () => {
  it('accepts matching passwords', () => {
    expect(passwordMismatch('same-password', 'same-password')).toBe('');
  });

  it('reports different passwords', () => {
    expect(passwordMismatch('same-password', 'other-password')).toBe("Passwords don't match");
  });

  it('is case sensitive', () => {
    expect(passwordMismatch('Password', 'password')).toBe("Passwords don't match");
  });

  it('waits until a confirmation is typed', () => {
    expect(passwordMismatch('same-password', '')).toBe('');
  });
});
