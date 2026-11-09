import { compactJsonText, formatJsonText, isJsonText, parseJsonText, type SecretFormat } from '@pulsegrid/shared';

export interface SecretDocument {
  format: SecretFormat;
  text: string | null;
  entries: Record<string, unknown> | null;
}

export interface SecretChange {
  key: string | null;
  name: string | null;
  value: string;
}

export type ChangeProblem = 'wrongFormat' | 'keyMissing' | 'keyExists' | 'invalidJson' | 'notAnObject';

export type ChangeResult = { text: string } | { problem: ChangeProblem };

const parseEntries = (value: string): Record<string, unknown> | null => {
  const parsed = parseJsonText(value);
  return parsed && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
};

export const parseSecret = (text: string | null): SecretDocument => {
  if (text === null) {
    return { format: 'binary', text, entries: null };
  }
  const entries = parseEntries(text);
  return { format: entries ? 'keyValue' : 'text', text, entries };
};

export const entryText = (entries: Record<string, unknown>, key: string): string | null => {
  if (!Object.hasOwn(entries, key)) {
    return null;
  }
  const value = entries[key];
  return typeof value === 'string' ? value : formatJsonText(JSON.stringify(value));
};

const updatedText = (original: string, text: string): string | undefined =>
  isJsonText(original) && !isJsonText(text) ? undefined : compactJsonText(text);

const updatedScalar = (original: number | boolean, text: string): unknown => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === typeof original ? parsed : text;
  } catch {
    return text;
  }
};

const updatedEntry = (original: unknown, text: string): unknown => {
  if (typeof original === 'string') {
    return updatedText(original, text);
  }
  if (typeof original === 'number' || typeof original === 'boolean') {
    return updatedScalar(original, text);
  }
  if (original === null) {
    return text === 'null' ? null : text;
  }
  return parseJsonText(text) ?? undefined;
};

const renamed = (
  entries: Record<string, unknown>,
  key: string,
  name: string,
  value: unknown,
): [string, unknown][] =>
  Object.entries(entries).map(([entryKey, entryValue]) =>
    entryKey === key ? [name, value] : [entryKey, entryValue],
  );

export interface KeyChanges {
  added: string[];
  changed: string[];
  removed: string[];
}

export const keyChanges = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): KeyChanges => {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  return {
    added: afterKeys.filter((key) => !Object.hasOwn(before, key)),
    changed: afterKeys.filter(
      (key) => Object.hasOwn(before, key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
    ),
    removed: beforeKeys.filter((key) => !Object.hasOwn(after, key)),
  };
};

const replaceEntries = (value: string): ChangeResult => {
  const entries = parseEntries(value);
  return entries ? { text: JSON.stringify(entries) } : { problem: 'notAnObject' };
};

const changeEntries = (
  entries: Record<string, unknown>,
  { key, name, value }: SecretChange,
): ChangeResult => {
  if (key === null && name === null) {
    return replaceEntries(value);
  }
  if (name === null) {
    return { problem: 'wrongFormat' };
  }
  if (key !== null && !Object.hasOwn(entries, key)) {
    return { problem: 'keyMissing' };
  }
  if (name !== key && Object.hasOwn(entries, name)) {
    return { problem: 'keyExists' };
  }
  if (key === null) {
    return { text: JSON.stringify(Object.fromEntries([...Object.entries(entries), [name, compactJsonText(value)]])) };
  }
  const updated = updatedEntry(entries[key], value);
  if (updated === undefined) {
    return { problem: 'invalidJson' };
  }
  return { text: JSON.stringify(Object.fromEntries(renamed(entries, key, name, updated))) };
};

export const applyChange = ({ entries, text }: SecretDocument, change: SecretChange): ChangeResult => {
  if (entries) {
    return changeEntries(entries, change);
  }
  if (text === null || change.key !== null || change.name !== null) {
    return { problem: 'wrongFormat' };
  }
  const updated = updatedText(text, change.value);
  return updated === undefined ? { problem: 'invalidJson' } : { text: updated };
};

export const withoutEntry = (entries: Record<string, unknown>, key: string): string =>
  JSON.stringify(Object.fromEntries(Object.entries(entries).filter(([name]) => name !== key)));
