import { describe, expect, it } from 'vitest';
import { formatTime, zoneLabel } from './format';

describe('formatTime', () => {
  it('shows UTC', () => {
    expect(formatTime('2026-11-06T10:15:00Z', 'utc')).toBe('6 Nov 2026, 10:15');
  });
});

describe('zoneLabel', () => {
  it('names UTC', () => {
    expect(zoneLabel('utc')).toBe('UTC');
  });

  it.each([
    [-240, 'Local (UTC+4)'],
    [300, 'Local (UTC-5)'],
    [-330, 'Local (UTC+5:30)'],
    [0, 'Local (UTC)'],
  ])('reads an offset of %i', (offset, label) => {
    expect(zoneLabel('local', offset)).toBe(label);
  });
});
