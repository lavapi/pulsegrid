import { Logger } from '@nestjs/common';
import {
  type PushEnvironment,
  type PushMessage,
  type PushResult,
  type PushSender,
  RELAY_PATHS,
  type RelayAnswer,
  relayCredential,
  type RelayInstallation,
  type RelayNotification,
} from '@pulsegrid/push';

const TIMEOUT_MS = 10_000;

export type Fetch = typeof fetch;

export interface RelayInstallations {
  find(relayUrl: string): Promise<RelayInstallation | null>;
  save(relayUrl: string, installation: RelayInstallation): Promise<void>;
  forget(relayUrl: string): Promise<void>;
}

const isInstallation = (value: unknown): value is RelayInstallation => {
  const { installationId, secret } = (value ?? {}) as Partial<RelayInstallation>;
  return typeof installationId === 'string' && typeof secret === 'string';
};

/**
 * Sends through the push relay, for servers without their own Apple key. It registers by itself the first time,
 * and again if the relay has forgotten it.
 */
export class RelayClient implements PushSender {
  private readonly logger = new Logger(RelayClient.name);
  private registering: Promise<RelayInstallation> | null = null;

  constructor(
    private readonly relayUrl: string,
    private readonly installations: RelayInstallations,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async send(deviceToken: string, environment: PushEnvironment, message: PushMessage): Promise<PushResult> {
    const notification: RelayNotification = { deviceToken, environment, message };
    try {
      const result = await this.deliver(notification);
      if (result !== 'unknown') return result;
      await this.installations.forget(this.relayUrl);
      const retried = await this.deliver(notification);
      return retried === 'unknown' ? 'failed' : retried;
    } catch (error) {
      this.logger.warn(`The push relay couldn't be used: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 'failed';
    }
  }

  /** What the relay said, or "unknown" when it doesn't know this server. */
  private async deliver(notification: RelayNotification): Promise<PushResult | 'unknown'> {
    const response = await this.post(RELAY_PATHS.notifications, notification, await this.installation());
    if (response.status === 401) return 'unknown';
    if (response.status !== 200) return 'failed';
    const { result } = (await response.json()) as Partial<RelayAnswer>;
    return result === 'sent' || result === 'gone' ? result : 'failed';
  }

  private async installation(): Promise<RelayInstallation> {
    const saved = await this.installations.find(this.relayUrl);
    if (saved) return saved;
    this.registering ??= this.register().finally(() => {
      this.registering = null;
    });
    return this.registering;
  }

  private async register(): Promise<RelayInstallation> {
    const response = await this.post(RELAY_PATHS.installations, {});
    const body: unknown = response.status === 201 ? await response.json() : null;
    if (!isInstallation(body)) throw new Error(`registering was refused (${response.status})`);
    await this.installations.save(this.relayUrl, body);
    return body;
  }

  private post(path: string, body: object, installation?: RelayInstallation): Promise<Response> {
    return this.fetchFn(`${this.relayUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(installation && { authorization: `Bearer ${relayCredential(installation)}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}
