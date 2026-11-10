import { createHash } from 'node:crypto';
import { TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REDIS } from '../src/redis/redis.module';
import type Redis from 'ioredis';
import {
  addPerson,
  LEAKED_PASSWORD,
  signIn,
  startTestApp,
  type TestContext,
  user,
} from './support/test-app';

const PASSWORD = 'correct horse battery';
const NEW_PASSWORD = 'another long passphrase';

describe('auth', () => {
  let context: TestContext;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());
  const newEmail = () => `person${(sequence += 1)}@example.test`;
  const login = (email: string, password = PASSWORD) =>
    http().post('/api/auth/sign-in').send({ email, password });
  const person = async (email = newEmail()) => {
    await addPerson(context, context.acme, { email, name: 'Ada', role: 'admin' }, PASSWORD);
    return email;
  };
  const cookiesOf = (response: request.Response) => ([] as string[]).concat(response.headers['set-cookie'] ?? []);
  const cookieFrom = (response: request.Response) => String(cookiesOf(response)[0]).split(';')[0] ?? '';
  const namedCookie = (response: request.Response, name: string) =>
    cookiesOf(response).find((cookie) => cookie.startsWith(`${name}=`))?.split(';')[0] ?? '';
  const sessionCookie = (response: request.Response) => namedCookie(response, 'devdash_session');
  const enableTwoFactor = async (cookie: string) => {
    const { body } = await http().post('/api/account/two-factor/start').set('Cookie', cookie).expect(201);
    const code = new TOTP({ secret: body.secret }).generate();
    const enabled = await http()
      .post('/api/account/two-factor/confirm')
      .set('Cookie', cookie)
      .send({ code })
      .expect(201);
    return { secret: body.secret as string, backupCodes: enabled.body.backupCodes as string[] };
  };

  beforeAll(async () => {
    context = await startTestApp();
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    await context.app.get<Redis>(REDIS).flushdb();
  });

  describe('signing in', () => {
    it('sets a protected session cookie', async () => {
      const response = await login(await person()).expect(200);
      expect(response.body).toEqual({ twoFactorRequired: false });
      const cookie = String(response.headers['set-cookie']);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
    });

    it('refuses requests sent from another site', async () => {
      const email = await person();
      const response = await login(email).set('Origin', 'https://attacker.example');
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('This request came from another site, so it was refused.');
      await login(email).set('Origin', 'http://localhost:3000').expect(200);
    });

    it('gives the same message for a wrong password and an unknown email', async () => {
      const email = await person();
      const wrong = await login(email, 'not the right password');
      const unknown = await login('nobody@example.test');
      expect(wrong.status).toBe(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('locks an account after repeated failures', async () => {
      const email = await person();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await login(email, 'not the right password').expect(401);
      }
      const locked = await login(email);
      expect(locked.status).toBe(401);
      expect(locked.body.message).toContain('Too many attempts');
    });
  });

  describe('two-factor', () => {
    const enrolled = async () => {
      const email = await person();
      const cookie = cookieFrom(await login(email));
      const details = await enableTwoFactor(cookie);
      const { body } = await login(email).expect(200);
      expect(body).toEqual({ twoFactorRequired: true });
      return { email, challenge: challengeOf(await login(email)), ...details };
    };
    const challengeOf = (response: request.Response) => namedCookie(response, 'devdash_challenge');
    const complete = (challenge: string, code: string) =>
      http().post('/api/auth/two-factor').set('Cookie', challenge).send({ code });

    it('blocks admins from the workspace until it is on', async () => {
      const cookie = cookieFrom(await login(await person()));
      const blocked = await http().get('/api/cloud/accounts').set('Cookie', cookie);
      expect(blocked.status).toBe(403);
      expect(blocked.body.message).toBe('Turn on two-factor authentication to continue.');
      await enableTwoFactor(cookie);
      await http().get('/api/cloud/accounts').set('Cookie', cookie).expect(200);
    });

    it('asks for a code, and gives no session without it', async () => {
      const { email } = await enrolled();
      const response = await login(email);
      expect(response.body).toEqual({ twoFactorRequired: true });
      expect(sessionCookie(response)).toBe('');
      const challenge = cookiesOf(response).find((cookie) => cookie.startsWith('devdash_challenge='));
      expect(challenge).toContain('HttpOnly');
    });

    it('refuses a wrong code and accepts a backup code once', async () => {
      const { email, challenge, backupCodes } = await enrolled();
      const code = backupCodes[0] ?? '';
      await complete(challenge, '000000').expect(401);
      const session = await complete(challenge, code).expect(200);
      expect(sessionCookie(session)).toContain('=');
      await complete(challengeOf(await login(email)), code).expect(401);
    });

    it('does not accept the same code twice', async () => {
      const { secret, challenge } = await enrolled();
      await complete(challenge, new TOTP({ secret }).generate()).expect(401);
    });

    it('needs the challenge cookie from this browser', async () => {
      const { backupCodes } = await enrolled();
      await complete('', backupCodes[0] ?? '').expect(401);
    });

    it('keeps counting wrong codes after a correct password', async () => {
      const { email } = await enrolled();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await complete(challengeOf(await login(email)), '000000').expect(401);
      }
      const locked = await login(email);
      expect(locked.status).toBe(401);
      expect(locked.body.message).toContain('Too many attempts');
    });

    it('accepts a backup code only once, even when sent twice at the same time', async () => {
      const { email, backupCodes } = await enrolled();
      const code = backupCodes[0] ?? '';
      const challenges = [challengeOf(await login(email)), challengeOf(await login(email))];
      const responses = await Promise.all(challenges.map((challenge) => complete(challenge, code)));
      expect(responses.map(({ status }) => status).sort()).toEqual([200, 401]);
    });

    it('still accepts backup codes saved before they were keyed', async () => {
      const { email } = await enrolled();
      const legacy = createHash('sha256').update('abcde12345').digest('hex');
      await context.owner.updateTable('accounts').set({ backup_codes: [legacy] }).where('email', '=', email).execute();
      await complete(challengeOf(await login(email)), 'ABCDE-12345').expect(200);
      const row = await context.owner.selectFrom('accounts').select('backup_codes').where('email', '=', email).executeTakeFirstOrThrow();
      expect(row.backup_codes).toEqual([]);
    });

    it('signs out other sessions when it is turned on', async () => {
      const email = await person();
      const first = cookieFrom(await login(email));
      const second = cookieFrom(await login(email));
      await enableTwoFactor(first);
      await http().get('/api/me').set('Cookie', second).expect(401);
      await http().get('/api/me').set('Cookie', first).expect(200);
    });

    it('stores the secret and backup codes protected', async () => {
      const { email, secret, backupCodes } = await enrolled();
      const row = await context.owner
        .selectFrom('accounts')
        .select(['totp_secret', 'backup_codes'])
        .where('email', '=', email)
        .executeTakeFirstOrThrow();
      expect(row.totp_secret).not.toContain(secret);
      expect(row.backup_codes).not.toContain(backupCodes[0]);
    });

    it('is required for every role, whatever they try to open', async () => {
      for (const role of ['viewer', 'developer', 'admin'] as const) {
        const email = newEmail();
        await addPerson(context, context.acme, { email, name: 'Ada', role }, PASSWORD);
        const cookie = cookieFrom(await login(email));
        const response = await http().get('/api/cloud/accounts').set('Cookie', cookie).expect(403);
        expect(response.body.message).toBe('Turn on two-factor authentication to continue.');
      }
    });

    it('cannot be turned off', async () => {
      const cookie = await signIn(context, context.acme, user('developer-a', 'developer'));
      await http().delete('/api/account/two-factor').set('Cookie', cookie).send({ code: '123456' }).expect(404);
    });
  });

  describe('passwords', () => {
    it('needs the current password to change it, and keeps this session', async () => {
      const email = await person();
      const cookie = cookieFrom(await login(email));
      await enableTwoFactor(cookie);
      const other = await login(email);
      expect(other.body.twoFactorRequired).toBe(true);
      await http()
        .put('/api/account/password')
        .set('Cookie', cookie)
        .send({ currentPassword: 'wrong', newPassword: NEW_PASSWORD })
        .expect(400);
      await http()
        .put('/api/account/password')
        .set('Cookie', cookie)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(204);
      await http().get('/api/me').set('Cookie', cookie).expect(200);
    });
  });

  describe('choosing a password', () => {
    it('refuses short and leaked passwords', async () => {
      const email = await person();
      const cookie = cookieFrom(await login(email));
      await enableTwoFactor(cookie);
      const change = (newPassword: string) =>
        http().put('/api/account/password').set('Cookie', cookie).send({ currentPassword: PASSWORD, newPassword });
      await change('short').expect(400);
      const leaked = await change(LEAKED_PASSWORD);
      expect(leaked.status).toBe(400);
      expect(leaked.body.message).toContain('data breach');
    });
  });

  describe('Google', () => {
    let browser = '';
    const start = async (query = '') => {
      const response = await http().get(`/api/auth/google${query}`).expect(302);
      browser = namedCookie(response, 'devdash_google_state');
      return new URL(response.headers.location ?? '').searchParams.get('state') ?? '';
    };
    const callback = (state: string, cookie = browser) =>
      http().get(`/api/auth/google/callback?state=${state}&code=abc`).set('Cookie', cookie).expect(302);
    const profile = (email: string, emailVerified = true) => ({
      subject: `google-${email}`,
      email,
      emailVerified,
      name: 'Grace',
    });

    it('reports that it is available', async () => {
      const { body } = await http().get('/api/auth/methods').expect(200);
      expect(body).toEqual({ google: true, setupRequired: false });
    });

    it('refuses people without an account', async () => {
      context.google.profile = profile(newEmail());
      expect((await callback(await start())).headers.location).toBe('/login?error=no_access');
    });

    it('signs in an existing account with the same verified email', async () => {
      const email = await person();
      context.google.profile = profile(email);
      const response = await callback(await start());
      expect(response.headers.location).toBe('/');
      expect(sessionCookie(response)).toContain('=');
    });

    it('refuses a callback from a browser that did not start the sign-in', async () => {
      context.google.profile = profile(await person());
      const state = await start();
      expect((await callback(state, '')).headers.location).toBe('/login?error=google_failed');
    });

    it('asks for two-factor when it is on', async () => {
      const email = await person();
      await enableTwoFactor(cookieFrom(await login(email)));
      context.google.profile = profile(email);
      const response = await callback(await start());
      expect(response.headers.location).toBe('/login?step=two-factor');
      expect(sessionCookie(response)).toBe('');
      expect(namedCookie(response, 'devdash_challenge')).toContain('=');
    });

    it('refuses unverified Google emails, unknown states and failures', async () => {
      context.google.profile = profile(newEmail(), false);
      expect((await callback(await start())).headers.location).toBe('/login?error=google_unverified');
      expect((await callback('forged')).headers.location).toBe('/login?error=google_failed');
      context.google.profile = null;
      expect((await callback(await start())).headers.location).toBe('/login?error=google_failed');
    });

    it('does not accept a state twice', async () => {
      context.google.profile = profile(await person());
      const state = await start();
      await callback(state);
      expect((await callback(state)).headers.location).toBe('/login?error=google_failed');
    });
  });
});
