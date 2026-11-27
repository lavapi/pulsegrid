import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { parseRelayNotification, type PushSender, type RelayAnswer, type RelayInstallation } from '@pulsegrid/push';
import type { RelayStore } from './relay-store';

export interface RelayLimits {
  notificationsPerDay: number;
  registrationsPerDay: number;
}

export interface RelayResponse {
  status: number;
  body: RelayInstallation | RelayAnswer | { message: string };
}

const CREDENTIAL = /^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const refusal = (status: number, message: string): RelayResponse => ({ status, body: { message } });

const REFUSALS = {
  unknown: refusal(401, 'This server is not registered with the push relay. Register it again.'),
  invalid: refusal(400, 'The notification is missing something, or a part of it is too long.'),
  tooManyNotifications: refusal(429, 'This server has sent all the notifications it may send today.'),
  tooManyRegistrations: refusal(429, 'Too many servers registered from this address today. Try again tomorrow.'),
};

/**
 * Sends notifications to the PulseGrid app for servers that don't hold LavaPi's Apple key. Each server registers
 * once for its own secret, and sends only up to its daily limit.
 */
export class PushRelay {
  constructor(
    private readonly store: RelayStore,
    private readonly sender: PushSender,
    private readonly limits: RelayLimits,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(sourceIp: string): Promise<RelayResponse> {
    const allowed = await this.store.countToday(`registrations#${sha256(sourceIp)}`, this.today(), this.limits.registrationsPerDay);
    if (!allowed) return REFUSALS.tooManyRegistrations;
    const installation = { installationId: randomUUID(), secret: randomBytes(32).toString('base64url') };
    await this.store.saveInstallation(installation.installationId, sha256(installation.secret), this.now());
    return { status: 201, body: installation };
  }

  async notify(authorization: string | undefined, body: unknown): Promise<RelayResponse> {
    const installationId = await this.authenticate(authorization);
    if (!installationId) return REFUSALS.unknown;
    const notification = parseRelayNotification(body);
    if (!notification) return REFUSALS.invalid;
    const allowed = await this.store.countToday(`notifications#${installationId}`, this.today(), this.limits.notificationsPerDay);
    if (!allowed) return REFUSALS.tooManyNotifications;
    const result = await this.sender.send(notification.deviceToken, notification.environment, notification.message);
    return { status: 200, body: { result } };
  }

  /** The installation the credential belongs to, or null for a wrong or unknown one. */
  private async authenticate(authorization: string | undefined): Promise<string | null> {
    const [, installationId, secret] = CREDENTIAL.exec(authorization ?? '') ?? [];
    if (!installationId || !secret) return null;
    const stored = await this.store.secretHashFor(installationId);
    if (!stored) return null;
    const matches = timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(sha256(secret), 'hex'));
    return matches ? installationId : null;
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }
}
