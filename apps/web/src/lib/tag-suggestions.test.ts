import { describe, expect, it } from 'vitest';
import { cleanTagFilter, keptCount, tagSuggestions } from './tag-suggestions';

const sets: Record<string, string>[] = [
  { Project: 'shop', Layer: 'web' },
  { Project: 'data', 'aws:stack': 'x' },
  {},
];

describe('tagSuggestions', () => {
  it('lists keys and values, without AWS managed tags', () => {
    expect(tagSuggestions(sets)).toEqual([
      { key: 'Layer', values: ['web'] },
      { key: 'Project', values: ['data', 'shop'] },
    ]);
  });
});

describe('keptCount', () => {
  it('previews a filter', () => {
    const include = [{ key: 'Project', value: 'shop' }];
    expect(keptCount(sets, { include: [], exclude: [], keepUntagged: false })).toBe(3);
    expect(keptCount(sets, { include, exclude: [], keepUntagged: false })).toBe(1);
    expect(keptCount(sets, { include, exclude: [], keepUntagged: true })).toBe(2);
    expect(keptCount(sets, { include: [], exclude: include, keepUntagged: false })).toBe(2);
  });
});

describe('cleanTagFilter', () => {
  it('drops empty rules, and treats an empty value as any value', () => {
    const rules = [
      { key: ' Project ', value: '' },
      { key: '', value: 'x' },
    ];
    expect(cleanTagFilter({ include: rules, exclude: [], keepUntagged: true })).toEqual({
      include: [{ key: 'Project', value: null }],
      exclude: [],
      keepUntagged: true,
    });
  });
});
