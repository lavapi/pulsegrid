import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const PREFIX_LENGTH = 5;
const TIMEOUT_MS = 3000;

export const LEAKED_PASSWORDS = Symbol('LEAKED_PASSWORDS');

export interface LeakedPasswords {
  isLeaked(password: string): Promise<boolean>;
}

export class PwnedPasswords implements LeakedPasswords {
  private readonly logger = new Logger(PwnedPasswords.name);

  async isLeaked(password: string): Promise<boolean> {
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = digest.slice(0, PREFIX_LENGTH);
    const suffix = digest.slice(PREFIX_LENGTH);
    try {
      const response = await fetch(`${RANGE_URL}${prefix}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await response.text();
      return body.split('\n').some((line) => line.startsWith(`${suffix}:`));
    } catch {
      this.logger.warn('The leaked password check is unavailable.');
      return false;
    }
  }
}
