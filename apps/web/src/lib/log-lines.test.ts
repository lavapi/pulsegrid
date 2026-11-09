import type { LogLine } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { lineSeverity, mergeLines } from './log-lines';

const line = (id: string) => ({ id }) as LogLine;

describe('lineSeverity', () => {
  it.each([
    ['ERROR failed to connect', 'error'],
    ['Unhandled exception', 'error'],
    ['WARN slow query', 'warning'],
    ['started on port 3000', 'normal'],
    ['errors_total metric', 'normal'],
  ])('reads %s', (message, severity) => {
    expect(lineSeverity(message)).toBe(severity);
  });
});

describe('mergeLines', () => {
  it('adds new lines without repeating any', () => {
    expect(mergeLines([line('a'), line('b')], [line('b'), line('c')]).map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the newest lines', () => {
    const many = Array.from({ length: 1000 }, (_, index) => line(String(index)));
    const merged = mergeLines(many, [line('new')]);
    expect(merged).toHaveLength(1000);
    expect(merged.at(-1)?.id).toBe('new');
  });
});
