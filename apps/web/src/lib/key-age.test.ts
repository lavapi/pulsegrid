import { describe, expect, it } from 'vitest';
import { isKeyOld, keyAgeDays, keyAgeText } from './key-age';

const now = Date.parse('2026-11-16T12:00:00Z');

describe('key age', () => {
  it('counts whole days since the key was set', () => {
    expect(keyAgeDays('2026-11-16T08:00:00Z', now)).toBe(0);
    expect(keyAgeDays('2026-11-15T11:00:00Z', now)).toBe(1);
    expect(keyAgeDays('2026-08-18T12:00:00Z', now)).toBe(90);
    expect(keyAgeDays(null, now)).toBeNull();
  });

  it('asks for rotation from 90 days', () => {
    expect(isKeyOld(89)).toBe(false);
    expect(isKeyOld(90)).toBe(true);
    expect(isKeyOld(null)).toBe(false);
  });

  it('says how old the key is', () => {
    expect(keyAgeText(0)).toBe('Key set today');
    expect(keyAgeText(1)).toBe('Key set 1 day ago');
    expect(keyAgeText(42)).toBe('Key set 42 days ago');
    expect(keyAgeText(null)).toBeNull();
  });
});
