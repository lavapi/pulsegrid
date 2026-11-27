import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

const DEVICE = "Ada's iPhone";
const PUSH_TOKEN = 'a'.repeat(64);

/** A PKCE pair, as the app makes one. */
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

describe('signing in the iPhone app', () => {
  let context: TestContext;
  let browser: string;
  const http = () => request(context.app.getHttpServer());
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  const codeFor = async (challenge: string, cookie = browser) =>
    (await http().post('/api/auth/device/codes').set('Cookie', cookie).send({ challenge, deviceName: DEVICE }).expect(201)).body
      .code as string;
  const signInApp = async () => {
    const { verifier, challenge } = pkce();
    const code = await codeFor(challenge);
    return (await http().post('/api/auth/device/token').send({ code, verifier }).expect(201)).body as {
      token: string;
      expiresAt: string;
    };
  };

  beforeAll(async () => {
    context = await startTestApp();
    browser = await signIn(context, context.acme, user('ada', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    await context.owner.deleteFrom('sessions').where('client', '=', 'ios').execute();
  });

  it('hands a browser sign-in to the app, which then signs in with its own token', async () => {
    const { token, expiresAt } = await signInApp();
    expect(Date.parse(expiresAt) - Date.now()).toBeGreaterThan(29 * 24 * 3_600_000);
    const { body } = await http().get('/api/me').set(bearer(token)).expect(200);
    expect(body).toMatchObject({ email: 'ada@example.test', tenant: { slug: 'acme' } });
    const events = await context.owner.selectFrom('audit_events').select('action').where('action', '=', 'auth.device_signed_in').execute();
    expect(events.length).toBeGreaterThan(0);
  });

  it('needs a browser sign-in to make a code', async () => {
    await http().post('/api/auth/device/codes').send({ challenge: pkce().challenge, deviceName: DEVICE }).expect(401);
  });

  it('swaps a code once, only with the verifier that made it, and not after two minutes', async () => {
    const first = pkce();
    const code = await codeFor(first.challenge);
    await http().post('/api/auth/device/token').send({ code, verifier: pkce().verifier }).expect(401);
    await http().post('/api/auth/device/token').send({ code, verifier: first.verifier }).expect(401);

    const second = pkce();
    const fresh = await codeFor(second.challenge);
    await http().post('/api/auth/device/token').send({ code: fresh, verifier: second.verifier }).expect(201);
    const { body } = await http().post('/api/auth/device/token').send({ code: fresh, verifier: second.verifier }).expect(401);
    expect(body.message).toBe('This sign-in has expired. Sign in again from the app.');

    const third = pkce();
    const old = await codeFor(third.challenge);
    await context.owner.updateTable('device_sign_in_codes').set({ expires_at: new Date(Date.now() - 1000) }).execute();
    await http().post('/api/auth/device/token').send({ code: old, verifier: third.verifier }).expect(401);
  });

  it('refuses a token that is malformed or signed out', async () => {
    await http().get('/api/me').set(bearer('not a token')).expect(401);
    await http().get('/api/me').set(bearer('x'.repeat(43))).expect(401);
  });

  it('lists the phones, marks the one asking, and signs one out from the browser', async () => {
    const { token } = await signInApp();
    const fromApp = (await http().get('/api/account/devices').set(bearer(token)).expect(200)).body;
    expect(fromApp).toEqual([expect.objectContaining({ name: DEVICE, current: true })]);
    const fromBrowser = (await http().get('/api/account/devices').set('Cookie', browser).expect(200)).body;
    expect(fromBrowser[0].current).toBe(false);

    await http().delete(`/api/account/devices/${fromBrowser[0].id}`).set('Cookie', browser).expect(204);
    await http().get('/api/me').set(bearer(token)).expect(401);
    await http().delete(`/api/account/devices/${fromBrowser[0].id}`).set('Cookie', browser).expect(404);
  });

  it('keeps a phone signed in while it is used', async () => {
    const { token } = await signInApp();
    await context.owner
      .updateTable('sessions')
      .set({ last_used_at: new Date(Date.now() - 2 * 24 * 3_600_000), expires_at: new Date(Date.now() + 24 * 3_600_000) })
      .where('client', '=', 'ios')
      .execute();
    await http().get('/api/me').set(bearer(token)).expect(200);
    const row = await context.owner.selectFrom('sessions').select('expires_at').where('client', '=', 'ios').executeTakeFirstOrThrow();
    expect(row.expires_at.getTime() - Date.now()).toBeGreaterThan(29 * 24 * 3_600_000);
  });

  it('registers the phone for notifications only from the app, and forgets it on sign-out', async () => {
    await http().put('/api/devices/push').set('Cookie', browser).send({ token: PUSH_TOKEN, environment: 'sandbox' }).expect(403);
    const { token } = await signInApp();
    await http().put('/api/devices/push').set(bearer(token)).send({ token: PUSH_TOKEN, environment: 'sandbox' }).expect(204);
    await http().put('/api/devices/push').set(bearer(token)).send({ token: 'not-hex', environment: 'sandbox' }).expect(400);

    const again = await signInApp();
    await http().put('/api/devices/push').set(bearer(again.token)).send({ token: PUSH_TOKEN, environment: 'production' }).expect(204);
    const rows = await context.owner.selectFrom('push_devices').select(['environment']).execute();
    expect(rows).toEqual([{ environment: 'production' }]);

    await http().post('/api/auth/logout').set(bearer(again.token)).expect(204);
    expect(await context.owner.selectFrom('push_devices').selectAll().execute()).toEqual([]);
  });

  it('returns to a page on this site after Google sign-in, never to another site', async () => {
    const next = '/mobile/sign-in?challenge=abc';
    const started = await http().get(`/api/auth/google?next=${encodeURIComponent(next)}`).expect(302);
    expect(String(started.headers['set-cookie'])).toContain(`devdash_next=${encodeURIComponent(next)}`);
    const elsewhere = await http().get(`/api/auth/google?next=${encodeURIComponent('//evil.example')}`).expect(302);
    expect(String(elsewhere.headers['set-cookie'])).not.toContain('devdash_next');
  });
});
