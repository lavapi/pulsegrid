import { describe, expect, it } from 'vitest';
import { applyChange, entryText, keyChanges, parseSecret, withoutEntry } from './secret-document';

const change = (secret: string, key: string | null, name: string | null, value: string) =>
  applyChange(parseSecret(secret), { key, name, value });
const saved = (result: ReturnType<typeof change>) => {
  if ('problem' in result) {
    throw new Error(result.problem);
  }
  return JSON.parse(result.text) as Record<string, unknown>;
};

describe('parseSecret', () => {
  it('reads a JSON object as keys, including nested values', () => {
    expect(parseSecret('{"A":"1","B":2,"C":{"d":true}}').format).toBe('keyValue');
  });

  it.each(['plain', '["a"]', '"text"', '12', 'null'])('treats %s as one value', (value) => {
    expect(parseSecret(value)).toMatchObject({ format: 'text', entries: null });
  });

  it('marks a secret with no text as binary', () => {
    expect(parseSecret(null).format).toBe('binary');
  });
});

describe('entryText', () => {
  it('shows values as text, with nested JSON indented', () => {
    const entries = { a: 'x', b: 2, c: null, d: { e: 1 } };
    expect(entryText(entries, 'b')).toBe('2');
    expect(entryText(entries, 'c')).toBe('null');
    expect(entryText(entries, 'd')).toBe('{\n  "e": 1\n}');
  });

  it('ignores inherited names', () => {
    expect(entryText({}, 'constructor')).toBeNull();
    expect(entryText({}, '__proto__')).toBeNull();
  });
});

describe('applyChange', () => {
  it('adds a key and keeps the others with their types', () => {
    expect(saved(change('{"a":"x","b":2}', null, 'c', 'new'))).toEqual({ a: 'x', b: 2, c: 'new' });
  });

  it('refuses to add a key that exists', () => {
    expect(change('{"a":"x"}', null, 'a', 'new')).toEqual({ problem: 'keyExists' });
  });

  it('renames a key in place and keeps its value', () => {
    const result = change('{"a":"x","b":2,"c":true}', 'b', 'renamed', '2');
    expect(result).toEqual({ text: '{"a":"x","renamed":2,"c":true}' });
  });

  it('changes the key and value together', () => {
    expect(saved(change('{"a":"x"}', 'a', 'b', 'y'))).toEqual({ b: 'y' });
  });

  it('refuses a rename onto another key, and a missing key', () => {
    expect(change('{"a":"x","b":"y"}', 'a', 'b', 'z')).toEqual({ problem: 'keyExists' });
    expect(change('{"a":"x"}', 'gone', 'a', 'z')).toEqual({ problem: 'keyMissing' });
  });

  it('keeps numbers, booleans and null when their type stays the same', () => {
    expect(saved(change('{"a":1}', 'a', 'a', '2'))).toEqual({ a: 2 });
    expect(saved(change('{"a":true}', 'a', 'a', 'false'))).toEqual({ a: false });
    expect(saved(change('{"a":null}', 'a', 'a', 'null'))).toEqual({ a: null });
  });

  it('stores other text when someone changes the type on purpose', () => {
    expect(saved(change('{"a":1}', 'a', 'a', 'many'))).toEqual({ a: 'many' });
    expect(saved(change('{"a":null}', 'a', 'a', 'set'))).toEqual({ a: 'set' });
  });

  it('keeps nested values as real JSON', () => {
    expect(saved(change('{"a":{"b":1}}', 'a', 'a', '{\n  "b": 2\n}'))).toEqual({ a: { b: 2 } });
    expect(change('{"a":{"b":1}}', 'a', 'a', '{broken')).toEqual({ problem: 'invalidJson' });
  });

  it('keeps JSON stored as text as compact text', () => {
    expect(saved(change('{"a":"{\\"b\\":1}"}', 'a', 'a', '{\n  "b": 2\n}'))).toEqual({ a: '{"b":2}' });
    expect(change('{"a":"{\\"b\\":1}"}', 'a', 'a', 'broken')).toEqual({ problem: 'invalidJson' });
  });

  it('replaces a single value secret', () => {
    expect(change('old', null, null, 'new')).toEqual({ text: 'new' });
    expect(change('old', 'a', 'a', 'new')).toEqual({ problem: 'wrongFormat' });
    expect(change('["a"]', null, null, '[ "b" ]')).toEqual({ text: '["b"]' });
    expect(change('["a"]', null, null, 'broken')).toEqual({ problem: 'invalidJson' });
  });

  it('refuses a key on a binary secret and a missing name on keys', () => {
    expect(applyChange(parseSecret(null), { key: null, name: null, value: 'x' })).toEqual({
      problem: 'wrongFormat',
    });
  });

  it('replaces every key at once, keeping types as typed', () => {
    expect(change('{"a":"x"}', null, null, '{\n  "b": 2,\n  "c": {"d": true}\n}')).toEqual({
      text: '{"b":2,"c":{"d":true}}',
    });
  });

  it('refuses a whole secret that is not a JSON object', () => {
    for (const value of ['y', '{broken', '["a"]', '12', 'null']) {
      expect(change('{"a":"x"}', null, null, value)).toEqual({ problem: 'notAnObject' });
    }
  });

  it('stores an unusual key as data', () => {
    expect(change('{}', null, '__proto__', 'x')).toEqual({ text: '{"__proto__":"x"}' });
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
  });
});

describe('keyChanges', () => {
  it('lists added, changed and removed keys', () => {
    const before = { same: 1, edited: { a: 1 }, gone: 'x' };
    const after = { same: 1, edited: { a: 2 }, fresh: true };
    expect(keyChanges(before, after)).toEqual({ added: ['fresh'], changed: ['edited'], removed: ['gone'] });
  });
});

describe('withoutEntry', () => {
  it('removes one key', () => {
    expect(JSON.parse(withoutEntry({ a: 'x', b: 2 }, 'a'))).toEqual({ b: 2 });
  });
});
