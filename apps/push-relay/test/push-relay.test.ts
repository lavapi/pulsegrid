import { createHash } from 'node:crypto';
import type { PushSender, RelayInstallation } from '@pulsegrid/push';
import { describe, expect, it, vi } from 'vitest';
import { PushRelay } from '../src/push-relay';
import { MemoryRelayStore } from './memory-relay-store';

const NOTIFICATION = {
  deviceToken: 'ab'.repeat(32),
  environment: 'production',
  message: { title: 'Database access request', body: 'Vic asks for 2 hours', path: '/settings/database-access', collapseId: 'db-1' },
};
const LIMITS = { notificationsPerDay: 2, registrationsPerDay: 2 };

const relayWith = (now = new Date('2026-11-26T10:00:00Z')) => {
  const store = new MemoryRelayStore();
  const sender = { send: vi.fn<PushSender['send']>(async () => 'sent') };
  const clock = { now };
  const relay = new PushRelay(store, sender, LIMITS, () => clock.now);
  return { relay, store, sender, clock };
};

const registered = async (relay: PushRelay): Promise<RelayInstallation> =>
  (await relay.register('203.0.113.7')).body as RelayInstallation;
const bearer = ({ installationId, secret }: RelayInstallation) => `Bearer ${installationId}.${secret}`;

describe('registering a server', () => {
  it('gives it an ID and a secret, and keeps only a hash of the secret', async () => {
    const { relay, store } = relayWith();
    const response = await relay.register('203.0.113.7');
    expect(response.status).toBe(201);
    const { installationId, secret } = response.body as RelayInstallation;
    expect(installationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.installations.get(installationId)).toBe(createHash('sha256').update(secret).digest('hex'));
  });

  it('allows only a few registrations from one address a day', async () => {
    const { relay, clock } = relayWith();
    await relay.register('203.0.113.7');
    await relay.register('203.0.113.7');
    expect((await relay.register('203.0.113.7')).status).toBe(429);
    expect((await relay.register('198.51.100.1')).status).toBe(201);
    clock.now = new Date('2026-11-27T00:00:01Z');
    expect((await relay.register('203.0.113.7')).status).toBe(201);
  });
});

describe('sending a notification', () => {
  it('passes it to Apple and says what happened', async () => {
    const { relay, sender } = relayWith();
    const installation = await registered(relay);
    sender.send.mockResolvedValueOnce('gone');
    expect(await relay.notify(bearer(installation), NOTIFICATION)).toEqual({ status: 200, body: { result: 'gone' } });
    expect(sender.send).toHaveBeenCalledWith(NOTIFICATION.deviceToken, 'production', NOTIFICATION.message);
  });

  it('turns away a server it does not know, or a wrong secret', async () => {
    const { relay, sender } = relayWith();
    const installation = await registered(relay);
    const unknown = { installationId: '00000000-0000-4000-8000-000000000000', secret: installation.secret };
    const wrongSecret = { ...installation, secret: 'x'.repeat(43) };
    for (const authorization of [undefined, 'Basic abc', bearer(unknown), bearer(wrongSecret), `Bearer ${installation.installationId}`]) {
      expect((await relay.notify(authorization, NOTIFICATION)).status).toBe(401);
    }
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('turns away an invalid notification without counting it', async () => {
    const { relay, store, sender } = relayWith();
    const installation = await registered(relay);
    expect((await relay.notify(bearer(installation), { ...NOTIFICATION, deviceToken: 'nope' })).status).toBe(400);
    expect([...store.counts.keys()].some((key) => key.startsWith('notifications#'))).toBe(false);
    expect(sender.send).not.toHaveBeenCalled();
  });

  it('stops at the daily limit for each server, and starts again the next day', async () => {
    const { relay, sender, clock } = relayWith();
    const first = await registered(relay);
    const second = await registered(relay);
    await relay.notify(bearer(first), NOTIFICATION);
    await relay.notify(bearer(first), NOTIFICATION);
    expect((await relay.notify(bearer(first), NOTIFICATION)).status).toBe(429);
    expect((await relay.notify(bearer(second), NOTIFICATION)).status).toBe(200);
    expect(sender.send).toHaveBeenCalledTimes(3);
    clock.now = new Date('2026-11-27T00:00:01Z');
    expect((await relay.notify(bearer(first), NOTIFICATION)).status).toBe(200);
  });
});
