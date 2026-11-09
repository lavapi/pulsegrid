export type SecretFormat = 'keyValue' | 'text' | 'binary';

export interface SecretAccess {
  canRead: boolean;
  canWrite: boolean;
  reason: string | null;
}

export interface SecretContent {
  format: SecretFormat;
  keys: string[];
  versionId: string;
}

export interface SecretView {
  access: SecretAccess;
  content: SecretContent | null;
  error: string | null;
}

const JSON_INDENT = 2;

export const parseJsonText = (text: string): object | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

export const isJsonText = (text: string): boolean => parseJsonText(text) !== null;

export const formatJsonText = (text: string): string => {
  const parsed = parseJsonText(text);
  return parsed ? JSON.stringify(parsed, null, JSON_INDENT) : text;
};

export const compactJsonText = (text: string): string => {
  const parsed = parseJsonText(text);
  return parsed ? JSON.stringify(parsed) : text;
};
