import { generateKeyPairSync, verify } from 'node:crypto';
import { safeNext } from '@pulsegrid/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApnsClient, type Http2Post } from '../src/push/apns-client';
import { ProductionReleaseAlerts } from '../src/production-releases/production-release-alerts';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const SETTINGS = {
  keyId: 'ABC123DEFG',
  teamId: 'TEAM123456',
  bundleId: 'com.example.pulsegrid',
  privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const MESSAGE = { title: 'Database access request', body: 'Vic asks for 2 hours', path: '/settings/database-access', collapseId: 'db-request-1' };
const TOKEN = 'ab'.repeat(32);

const answering = (status: number, body = '') => vi.fn<Http2Post>(async () => ({ status, body }));

describe('Apple push', () => {
  it('sends the alert to the right host and topic, with a token signed by the team key', async () => {
    const post = answering(200);
    expect(await new ApnsClient(SETTINGS, post).send(TOKEN, 'sandbox', MESSAGE)).toBe('sent');
    const [host, path, headers, body] = post.mock.calls[0]!;
    expect(host).toBe('https://api.sandbox.push.apple.com');
    expect(path).toBe(`/3/device/${TOKEN}`);
    expect(headers).toMatchObject({ 'apns-topic': SETTINGS.bundleId, 'apns-push-type': 'alert', 'apns-collapse-id': 'db-request-1' });
    expect(JSON.parse(body)).toEqual({
      aps: { alert: { title: MESSAGE.title, body: MESSAGE.body }, sound: 'default' },
      path: MESSAGE.path,
    });

    const [header, claims, signature] = headers.authorization!.replace('bearer ', '').split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: SETTINGS.keyId });
    expect(JSON.parse(Buffer.from(claims!, 'base64url').toString())).toMatchObject({ iss: SETTINGS.teamId });
    const valid = verify('sha256', Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature!, 'base64url'));
    expect(valid).toBe(true);
  });

  it('reuses the signed token, and uses the production host for App Store builds', async () => {
    const post = answering(200);
    const client = new ApnsClient(SETTINGS, post);
    await client.send(TOKEN, 'production', MESSAGE);
    await client.send(TOKEN, 'production', MESSAGE);
    expect(post.mock.calls[0]![0]).toBe('https://api.push.apple.com');
    expect(post.mock.calls[0]![2].authorization).toBe(post.mock.calls[1]![2].authorization);
  });

  it('says when a phone no longer takes notifications, and when sending failed', async () => {
    expect(await new ApnsClient(SETTINGS, answering(410, '{"reason":"Unregistered"}')).send(TOKEN, 'sandbox', MESSAGE)).toBe('gone');
    expect(await new ApnsClient(SETTINGS, answering(400, '{"reason":"BadDeviceToken"}')).send(TOKEN, 'sandbox', MESSAGE)).toBe('gone');
    expect(await new ApnsClient(SETTINGS, answering(429, '{"reason":"TooManyRequests"}')).send(TOKEN, 'sandbox', MESSAGE)).toBe('failed');
    const offline = vi.fn<Http2Post>(async () => Promise.reject(new Error('connect failed')));
    expect(await new ApnsClient(SETTINGS, offline).send(TOKEN, 'sandbox', MESSAGE)).toBe('failed');
  });
});

describe('returning after sign-in', () => {
  it('allows only a path on this site', () => {
    expect(safeNext('/mobile/sign-in?challenge=abc&device=Ada%27s%20iPhone')).toBe('/mobile/sign-in?challenge=abc&device=Ada%27s%20iPhone');
    for (const unsafe of ['//evil.example', '/\\evil.example', 'https://evil.example', 'mobile', '/a b', 42, undefined]) {
      expect(safeNext(unsafe)).toBeNull();
    }
  });
});

describe('waiting production release alerts', () => {
  const waiting = { id: 'rel-1', status: 'HOLD', decision: null, requestedBy: 'ada@example.test' };
  const alertsWith = (release: object | null, setOnce = true) => {
    const push = { toPermission: vi.fn() };
    const redis = { set: vi.fn(async () => (setOnce ? 'OK' : null)) };
    const db = { selectFrom: () => ({ select: () => ({ where: () => ({ executeTakeFirst: async () => ({ id: 'tenant-1' }) }) }) }) };
    const alerts = new ProductionReleaseAlerts(
      { current: async () => release } as never,
      { projectSlug: 'acme' } as never,
      db as never,
      redis as never,
      push as never,
    );
    return { alerts, push, redis };
  };

  it('tells the people who decide, once per release', async () => {
    const { alerts, push, redis } = alertsWith(waiting);
    await alerts.check();
    expect(redis.set).toHaveBeenCalledWith('production-release:announced:rel-1', '1', 'EX', expect.any(Number), 'NX');
    expect(push.toPermission).toHaveBeenCalledWith('tenant-1', 'production.release.decide', {
      title: 'Production release waiting',
      body: 'ada@example.test is waiting for you to finish or roll it back.',
      path: '/production-releases',
      collapseId: 'release-rel-1',
    });
  });

  it('stays quiet for a release already announced, decided, or not waiting', async () => {
    for (const { alerts, push } of [
      alertsWith(waiting, false),
      alertsWith({ ...waiting, decision: 'FINISH' }),
      alertsWith({ ...waiting, status: 'SUCCEEDED' }),
      alertsWith(null),
    ]) {
      await alerts.check();
      expect(push.toPermission).not.toHaveBeenCalled();
    }
  });
});
