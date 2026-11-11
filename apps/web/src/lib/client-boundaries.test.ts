import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');
const EXTENSIONS = ['.tsx', '.ts'];
const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g;
const COMPONENT = /^[A-Z][a-z]/;

const filesUnder = (folder: string): string[] =>
  readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesUnder(path) : EXTENSIONS.some((ext) => path.endsWith(ext)) ? [path] : [];
  });

const isClient = (source: string): boolean => /^\s*['"]use client['"]/.test(source);

const resolveImport = (from: string, specifier: string): string | null => {
  const base = specifier.startsWith('@/') ? join(SRC, specifier.slice(2)) : specifier.startsWith('.') ? resolve(dirname(from), specifier) : null;
  if (!base) {
    return null;
  }
  const candidates = [...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => join(base, `index${ext}`))];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
};

/**
 * A server component can render a client component, but it can't call a function or read a value
 * exported from a 'use client' file: Next.js swaps those for references, and the page fails at runtime.
 */
const valuesImportedAcrossTheBoundary = (): string[] => {
  const files = filesUnder(SRC).filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'));
  const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
  return files.flatMap((file) => {
    const source = sources.get(file) ?? '';
    if (isClient(source)) {
      return [];
    }
    return [...source.matchAll(IMPORT)].flatMap(([, typeOnly, names = '', specifier = '']) => {
      const target = typeOnly ? null : resolveImport(file, specifier);
      if (!target || !isClient(sources.get(target) ?? '')) {
        return [];
      }
      return names
        .split(',')
        .map((name) => name.trim().split(/\s+as\s+/)[0] ?? '')
        .filter((name) => name && !name.startsWith('type ') && !COMPONENT.test(name))
        .map((name) => `${file.replace(SRC, 'src')} imports ${name} from ${specifier}`);
    });
  });
};

describe('client boundaries', () => {
  it('only imports components from client files into server files', () => {
    expect(valuesImportedAcrossTheBoundary()).toEqual([]);
  });
});
