import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class TokenCipher {
  constructor(private readonly key: Buffer) {}

  encrypt(value: unknown, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }

  decrypt<T>(payload: string, context: string): T {
    const data = Buffer.from(payload, 'base64');
    const decipher = createDecipheriv(ALGORITHM, this.key, data.subarray(0, IV_BYTES));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const decrypted = Buffer.concat([
      decipher.update(data.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  }
}
