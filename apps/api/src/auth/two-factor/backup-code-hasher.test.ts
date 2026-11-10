import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BackupCodeHasher } from './backup-code-hasher';

const hasher = new BackupCodeHasher(Buffer.alloc(32, 1));

describe('BackupCodeHasher', () => {
  it('ignores case and dashes', () => {
    expect(hasher.hash('ABCDE-12345')).toBe(hasher.hash('abcde12345'));
  });

  it('depends on the server key', () => {
    expect(new BackupCodeHasher(Buffer.alloc(32, 2)).hash('abcde12345')).not.toBe(hasher.hash('abcde12345'));
  });

  it('still matches codes saved with the old unkeyed hash', () => {
    const legacy = createHash('sha256').update('abcde12345').digest('hex');
    expect(hasher.candidates('ABCDE-12345')).toContain(legacy);
  });
});
