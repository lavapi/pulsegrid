import { isIP } from 'node:net';
import { Injectable, Logger } from '@nestjs/common';

/** AWS's own service that answers with the address a request came from. */
const CHECK_URL = 'https://checkip.amazonaws.com';
const TIMEOUT_MS = 3000;
const KEEP_MS = 10 * 60_000;

/**
 * The public address PulseGrid reaches the internet from, such as its NAT gateway. Access keys can be locked to it,
 * and the key check simulates policies as if calls came from it.
 */
@Injectable()
export class OutboundAddress {
  private readonly logger = new Logger(OutboundAddress.name);
  private cached: { address: string | null; until: number } | null = null;

  async current(): Promise<string | null> {
    if (this.cached && this.cached.until > Date.now()) {
      return this.cached.address;
    }
    const address = await this.lookUp();
    this.cached = { address, until: Date.now() + KEEP_MS };
    return address;
  }

  private async lookUp(): Promise<string | null> {
    try {
      const response = await fetch(CHECK_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const address = (await response.text()).trim();
      return response.ok && isIP(address) ? address : null;
    } catch (error) {
      this.logger.warn(`Finding the outbound address failed: ${(error as Error).name}`);
      return null;
    }
  }
}
