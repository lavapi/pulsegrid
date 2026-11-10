import { createHash, createHmac, hkdfSync } from 'node:crypto';

const KEY_INFO = 'backup-codes';
const KEY_BYTES = 32;

const normalize = (code: string): string => code.trim().toLowerCase().replaceAll('-', '');

const legacyHash = (code: string): string => createHash('sha256').update(normalize(code)).digest('hex');

export class BackupCodeHasher {
  private readonly key: Buffer;

  constructor(secret: Buffer) {
    this.key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), KEY_INFO, KEY_BYTES));
  }

  hash(code: string): string {
    return createHmac('sha256', this.key).update(normalize(code)).digest('hex');
  }

  /** Codes saved before keyed hashing still match until they are used. */
  candidates(code: string): string[] {
    return [this.hash(code), legacyHash(code)];
  }
}
