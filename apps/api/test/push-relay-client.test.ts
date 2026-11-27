import { ApnsClient, type RelayInstallation } from '@pulsegrid/push';
import { generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PUSH_RELAY_URL, loadAppConfig } from '../src/config/app-config';
import { type Fetch, RelayClient, type RelayInstallations } from '../src/push/relay-client';
import { pushSenderFor } from '../src/push/push-sender-choice';
import { RelayInstallationsStore } from '../src/push/relay-installations.store';
import { startTestApp, type TestContext } from './support/test-app';

const RELAY = 'https://relay.example.test';
const TOKEN = 'ab'.repeat(32);
const MESSAGE = { title: 'Database access request', body: 'Vic asks for 2 hours', path: '/settings/database-access', collapseId: 'db-1' };
const INSTALLATION = { installationId: '11111111-1111-4111-8111-111111111111', secret: 's'.repeat(43) };
const SECOND = { installationId: '22222222-2222-4222-8222-222222222222', secret: 't'.repeat(43) };

class MemoryInstallations implements RelayInstallations {
  readonly saved = new Map<string, RelayInstallation>();
  async find(url: string) {
    return this.saved.get(url) ?? null;
  }
  async save(url: string, installation: RelayInstallation) {
    this.saved.set(url, installation);
  }
  async forget(url: string) {
    this.saved.delete(url);
  }
}

const json = (status: number, body: object) => new Response(JSON.stringify(body), { status });

/** A relay that answers from a list, in order. */
const relayAnswering = (...answers: Response[]) => vi.fn<Fetch>(async () => answers.shift() ?? json(500, {}));
const calls = (fetch: ReturnType<typeof relayAnswering>) =>
  fetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    authorization: (init?.headers as Record<string, string>)['authorization'],
    body: JSON.parse(init?.body as string) as object,
  }));

describe('sending through the push relay', () => {
  it('registers the first time, keeps the installation, and sends with its secret', async () => {
    const installations = new MemoryInstallations();
    const fetch = relayAnswering(json(201, INSTALLATION), json(200, { result: 'sent' }), json(200, { result: 'gone' }));
    const client = new RelayClient(RELAY, installations, fetch);
    expect(await client.send(TOKEN, 'production', MESSAGE)).toBe('sent');
    expect(await client.send(TOKEN, 'sandbox', MESSAGE)).toBe('gone');
    expect(installations.saved.get(RELAY)).toEqual(INSTALLATION);
    expect(calls(fetch)).toEqual([
      { url: `${RELAY}/v1/installations`, authorization: undefined, body: {} },
      {
        url: `${RELAY}/v1/notifications`,
        authorization: `Bearer ${INSTALLATION.installationId}.${INSTALLATION.secret}`,
        body: { deviceToken: TOKEN, environment: 'production', message: MESSAGE },
      },
      expect.objectContaining({ url: `${RELAY}/v1/notifications` }),
    ]);
  });

  it('registers again, once, when the relay has forgotten this server', async () => {
    const installations = new MemoryInstallations();
    await installations.save(RELAY, INSTALLATION);
    const fetch = relayAnswering(json(401, {}), json(201, SECOND), json(200, { result: 'sent' }));
    expect(await new RelayClient(RELAY, installations, fetch).send(TOKEN, 'production', MESSAGE)).toBe('sent');
    expect(installations.saved.get(RELAY)).toEqual(SECOND);

    const stillUnknown = relayAnswering(json(401, {}), json(201, INSTALLATION), json(401, {}));
    expect(await new RelayClient(RELAY, installations, stillUnknown).send(TOKEN, 'production', MESSAGE)).toBe('failed');
    expect(stillUnknown).toHaveBeenCalledTimes(3);
  });

  it('registers only once when several notifications go out together', async () => {
    const fetch = relayAnswering(json(201, INSTALLATION), json(200, { result: 'sent' }), json(200, { result: 'sent' }));
    const client = new RelayClient(RELAY, new MemoryInstallations(), fetch);
    expect(await Promise.all([client.send(TOKEN, 'production', MESSAGE), client.send(TOKEN, 'production', MESSAGE)])).toEqual([
      'sent',
      'sent',
    ]);
    expect(calls(fetch).filter(({ url }) => url.endsWith('/v1/installations'))).toHaveLength(1);
  });

  it('says failed when the relay refuses, is over its limit, or is out of reach', async () => {
    const installations = new MemoryInstallations();
    expect(await new RelayClient(RELAY, installations, relayAnswering(json(429, {}))).send(TOKEN, 'production', MESSAGE)).toBe('failed');
    expect(installations.saved.size).toBe(0);
    await installations.save(RELAY, INSTALLATION);
    for (const answer of [json(429, {}), json(400, {}), json(200, { result: 'weird' })]) {
      expect(await new RelayClient(RELAY, installations, relayAnswering(answer)).send(TOKEN, 'production', MESSAGE)).toBe('failed');
    }
    const offline = vi.fn<Fetch>(async () => Promise.reject(new TypeError('fetch failed')));
    expect(await new RelayClient(RELAY, installations, offline).send(TOKEN, 'production', MESSAGE)).toBe('failed');
  });
});

describe('choosing how to send', () => {
  const ENV = { PUBLIC_URL: 'http://localhost:3000', DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
  const privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const APPLE = { APNS_KEY_ID: 'ABC123DEFG', APNS_TEAM_ID: 'TEAM123456', APNS_BUNDLE_ID: 'com.example.app', APNS_PRIVATE_KEY: privateKey };
  const installations = new MemoryInstallations();

  it('uses the LavaPi relay unless told otherwise', () => {
    expect(loadAppConfig(ENV).pushRelayUrl).toBe(DEFAULT_PUSH_RELAY_URL);
    expect(loadAppConfig({ ...ENV, PUSH_RELAY_URL: 'https://push.example.test/' }).pushRelayUrl).toBe('https://push.example.test');
    expect(pushSenderFor(loadAppConfig(ENV), installations)).toBeInstanceOf(RelayClient);
  });

  it('sends to Apple directly with its own key, and sends nothing when the relay is turned off', () => {
    expect(pushSenderFor(loadAppConfig({ ...ENV, ...APPLE }), installations)).toBeInstanceOf(ApnsClient);
    expect(pushSenderFor(loadAppConfig({ ...ENV, PUSH_RELAY_URL: '' }), installations)).toBeNull();
  });
});

describe('the saved relay installation', () => {
  let context: TestContext;
  const store = () => context.app.get(RelayInstallationsStore);

  beforeAll(async () => {
    context = await startTestApp();
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    await context.owner.deleteFrom('push_relay_installations').execute();
  });

  it('keeps one installation per relay, with the secret encrypted', async () => {
    await store().save(RELAY, INSTALLATION);
    await store().save(RELAY, SECOND);
    await store().save('https://other.example.test', INSTALLATION);
    expect(await store().find(RELAY)).toEqual(SECOND);
    const rows = await context.owner.selectFrom('push_relay_installations').selectAll().execute();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.secret_encrypted)).not.toContain(SECOND.secret);
    await store().forget(RELAY);
    expect(await store().find(RELAY)).toBeNull();
    expect(await store().find('https://other.example.test')).toEqual(INSTALLATION);
  });
});
