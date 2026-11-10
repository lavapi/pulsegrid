import { SETUP_CODE_EXPIRED } from '@pulsegrid/shared';
import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { REDIS } from '../src/redis/redis.module';
import { LEAKED_PASSWORD, startTestApp, type TestContext } from './support/test-app';

const CODE_KEY = 'setup:code';

describe('first-run setup', () => {
  let context: TestContext;
  let code: string;
  const http = () => request(context.app.getHttpServer());
  const details = {
    company: 'Acme Corp',
    name: 'Ada',
    email: 'Owner@Example.test',
    password: 'correct horse battery',
  };
  const methods = async () => (await http().get('/api/auth/methods').expect(200)).body;

  beforeAll(async () => {
    context = await startTestApp();
    code = (await context.app.get<Redis>(REDIS).get(CODE_KEY)) ?? '';
  });
  afterAll(() => context.close());

  it('asks for setup when the app has no users', async () => {
    expect(code).not.toBe('');
    expect(await methods()).toEqual({ google: true, setupRequired: true });
  });

  it('has no public way to create an account or reset a password', async () => {
    for (const path of ['sign-up', 'forgot-password', 'reset-password', 'verify-email']) {
      await http().post(`/api/auth/${path}`).send(details).expect(404);
    }
  });

  it('refuses a wrong setup code', async () => {
    const check = await http().post('/api/auth/setup/check').send({ code: 'wrong' });
    expect(check.status).toBe(400);
    expect(check.body.message).toBe('That setup code is incorrect.');
    await http().post('/api/auth/setup').send({ ...details, code: 'wrong' }).expect(400);
    expect((await methods()).setupRequired).toBe(true);
  });

  it('keeps a valid code when a wrong one is tried', async () => {
    await http().post('/api/auth/setup/check').send({ code: 'wrong' }).expect(400);
    expect(await context.app.get<Redis>(REDIS).get(CODE_KEY)).toBe(code);
  });

  it('logs a new code when the old one is lost', async () => {
    const redis = context.app.get<Redis>(REDIS);
    const log = vi.spyOn(Logger.prototype, 'log');

    for (const attempt of [
      () => http().post('/api/auth/setup/check').send({ code }),
      () => http().post('/api/auth/setup').send({ ...details, code }),
    ]) {
      await redis.del(CODE_KEY);
      const response = await attempt();
      expect(response.status).toBe(400);
      expect(response.body.message).toBe(SETUP_CODE_EXPIRED);
      expect(JSON.stringify(response.body)).not.toContain((await redis.get(CODE_KEY)) ?? 'missing');
    }

    code = (await redis.get(CODE_KEY)) ?? '';
    expect(code).not.toBe('');
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`Setup code: ${code}.`));
    log.mockRestore();
    await http().post('/api/auth/setup/check').send({ code }).expect(204);
  });

  it('refuses a leaked password', async () => {
    const response = await http().post('/api/auth/setup').send({ ...details, password: LEAKED_PASSWORD, code });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('data breach');
    await http().post('/api/auth/setup').send({ ...details, password: 'short', code }).expect(400);
  });

  it('creates the workspace and owner, then requires two-factor', async () => {
    await http().post('/api/auth/setup/check').send({ code }).expect(204);
    const response = await http().post('/api/auth/setup').send({ ...details, code }).expect(200);
    const cookie = String(response.headers['set-cookie']).split(';')[0] ?? '';
    const me = await http().get('/api/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({
      email: 'owner@example.test',
      roleName: 'Admin',
      isOwner: true,
      mustChangePassword: false,
      twoFactorEnabled: false,
      tenant: { name: 'Acme Corp' },
    });
    const owner = await context.owner
      .selectFrom('accounts')
      .select('is_super_admin')
      .where('email', '=', 'owner@example.test')
      .executeTakeFirstOrThrow();
    expect(owner.is_super_admin).toBe(true);
    const account = await context.owner
      .selectFrom('accounts')
      .select('password_hash')
      .where('email', '=', 'owner@example.test')
      .executeTakeFirstOrThrow();
    expect(account.password_hash).toMatch(/^\$argon2id\$/);
    const environments = await context.owner
      .selectFrom('environments')
      .select('name')
      .orderBy('name')
      .execute();
    expect(environments.map(({ name }) => name)).toEqual(['Production', 'Staging']);
  });

  it('never runs twice', async () => {
    expect((await methods()).setupRequired).toBe(false);
    await http().post('/api/auth/setup/check').send({ code }).expect(409);
    await http()
      .post('/api/auth/setup')
      .send({ ...details, email: 'second@example.test', code })
      .expect(409);
    expect(await context.app.get<Redis>(REDIS).get(CODE_KEY)).toBeNull();
  });

  it('refuses Google users who were not added', async () => {
    context.google.profile = {
      subject: 'google-stranger',
      email: 'stranger@example.test',
      emailVerified: true,
      name: 'Stranger',
    };
    const started = await http().get('/api/auth/google').expect(302);
    const state = new URL(started.headers.location ?? '').searchParams.get('state');
    const response = await http()
      .get(`/api/auth/google/callback?state=${state}&code=x`)
      .set('Cookie', `devdash_google_state=${state}`)
      .expect(302);
    expect(response.headers.location).toBe('/login?error=no_access');
  });
});
