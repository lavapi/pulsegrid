import { describe, expect, it } from 'vitest';
import { githubProvider } from './github.provider';

describe('githubProvider', () => {
  it('accepts a token and shows only its end', () => {
    const credentials = githubProvider.parseCredentials({ token: 'github_pat_abcdefghijklmnop' });
    expect(credentials).toEqual({ token: 'github_pat_abcdefghijklmnop' });
    expect(githubProvider.credentialHint(credentials ?? {})).toBe('…mnop');
  });

  it('refuses a missing or short token', () => {
    expect(githubProvider.parseCredentials({})).toBeNull();
    expect(githubProvider.parseCredentials({ token: 'short' })).toBeNull();
  });
});
