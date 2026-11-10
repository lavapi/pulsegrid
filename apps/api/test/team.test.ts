import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LEAKED_PASSWORD,
  roleId,
  signIn,
  startTestApp,
  type TestContext,
  type TestRole,
  user,
} from './support/test-app';

const PASSWORD = 'correct horse battery';

describe('team', () => {
  let context: TestContext;
  let admin: string;
  let adminId: string;
  let other: string;
  let roleIds: Record<TestRole, string>;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());
  const newEmail = () => `member${(sequence += 1)}@example.test`;
  const createPerson = (email: string, cookie = admin) =>
    http().post('/api/people').set('Cookie', cookie).send({ firstName: 'New', lastName: 'Person', email });
  const add = async (email: string, role: TestRole = 'developer') => {
    const created = await createPerson(email);
    if (created.status === 201) {
      await http()
        .post('/api/team/assignments')
        .set('Cookie', admin)
        .send({ accountId: await accountId(email.toLowerCase()), roleId: roleIds[role] })
        .expect(204);
    }
    return created;
  };
  const addOk = async (email: string, role: TestRole = 'developer') => {
    const created = await add(email, role);
    expect(created.status).toBe(201);
    return created;
  };
  const login = (email: string, password: string) =>
    http().post('/api/auth/sign-in').send({ email, password });
  const cookieFrom = (response: request.Response) =>
    String(response.headers['set-cookie']).split(';')[0] ?? '';
  const replace = (cookie: string, newPassword: string) =>
    http().post('/api/account/password/temporary').set('Cookie', cookie).send({ newPassword });
  const join = async (email: string, role: TestRole = 'developer') => {
    const { body } = await addOk(email, role);
    const cookie = cookieFrom(await login(email, body.password).expect(200));
    await replace(cookie, PASSWORD).expect(204);
    return cookie;
  };
  const accountId = async (email: string) =>
    (await context.owner.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow()).id;
  const removeFromPool = async (email: string) =>
    http().delete(`/api/people/${await accountId(email)}`).set('Cookie', admin).expect(204);
  const memberId = async (email: string) => {
    const { body } = await http().get('/api/team').set('Cookie', admin).expect(200);
    return body.members.find((item: { email: string }) => item.email === email).id as string;
  };

  beforeAll(async () => {
    context = await startTestApp();
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    adminId = (await http().get('/api/me').set('Cookie', admin)).body.id;
    other = await signIn(context, context.globex, user('ada', 'admin'));
    roleIds = {
      viewer: await roleId(context, context.acme, 'viewer'),
      developer: await roleId(context, context.acme, 'developer'),
      admin: await roleId(context, context.acme, 'admin'),
    };
  });
  afterAll(() => context.close());

  describe('adding people', () => {
    it('creates the person straight away with a temporary password', async () => {
      const email = newEmail();
      const { body } = await addOk(email);
      expect(body.password.length).toBeGreaterThanOrEqual(24);
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);

      const team = await http().get('/api/team').set('Cookie', admin).expect(200);
      expect(team.body.members.find((item: { email: string }) => item.email === email)).toMatchObject({
        displayName: 'New Person',
        roleName: 'Developer',
        isOwner: false,
      });
      const account = await context.owner
        .selectFrom('accounts')
        .select('password_hash')
        .where('email', '=', email)
        .executeTakeFirstOrThrow();
      expect(account.password_hash).toMatch(/^\$argon2id\$/);
      expect(account.password_hash).not.toContain(body.password);
    });

    it('must choose a new password at first sign-in', async () => {
      const email = newEmail();
      const { body } = await addOk(email);
      const cookie = cookieFrom(await login(email, body.password).expect(200));
      const me = await http().get('/api/me').set('Cookie', cookie).expect(200);
      expect(me.body).toMatchObject({
        mustChangePassword: true,
        roleName: 'Developer',
        permissions: expect.arrayContaining(['pipeline.run']),
        isOwner: false,
        tenant: { slug: 'acme' },
      });
      await http().get('/api/cloud/accounts').set('Cookie', cookie).expect(403);
      await replace(cookie, PASSWORD).expect(204);
      const pending = await http().get('/api/cloud/accounts').set('Cookie', cookie).expect(403);
      expect(pending.body.message).toBe('Turn on two-factor authentication to continue.');
      await login(email, PASSWORD).expect(200);
    });

    it('refuses an expired first password until the person is added again', async () => {
      const email = newEmail();
      const { body } = await addOk(email);
      await context.owner
        .updateTable('accounts')
        .set({ temporary_password_expires_at: new Date(Date.now() - 1000) })
        .where('email', '=', email)
        .execute();
      await login(email, body.password).expect(401);
      await removeFromPool(email);
      const { body: fresh } = await addOk(email);
      await login(email, fresh.password).expect(200);
    });

    it('stores the email in lower case and refuses one already in use', async () => {
      const email = newEmail();
      await addOk(email.toUpperCase());
      const repeat = await add(email);
      expect(repeat.status).toBe(409);
      expect(repeat.body.message).toBe('That email already has an account.');
      await memberId(email);
      const elsewhere = await createPerson(email, other);
      expect(elsewhere.status).toBe(409);
    });

    it('refuses missing names and a bad email', async () => {
      const valid = { firstName: 'New', lastName: 'Person', email: newEmail() };
      for (const change of [{ firstName: ' ' }, { lastName: '' }, { email: 'nope' }]) {
        const response = await http().post('/api/people').set('Cookie', admin).send({ ...valid, ...change });
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Enter a first name, last name and valid email.');
      }
      const unknownRole = await http()
        .post('/api/team/assignments')
        .set('Cookie', admin)
        .send({ accountId: await accountId('ada@example.test'), roleId: 'owner' });
      expect(unknownRole.status).toBe(400);
    });

    it('lets people use Google when the email matches', async () => {
      const email = newEmail();
      await addOk(email);
      context.google.profile = { subject: `g-${email}`, email, emailVerified: true, name: 'New' };
      const started = await http().get('/api/auth/google').expect(302);
      const state = new URL(started.headers.location ?? '').searchParams.get('state');
      const response = await http()
        .get(`/api/auth/google/callback?state=${state}&code=x`)
        .set('Cookie', `devdash_google_state=${state}`)
        .expect(302);
      expect(response.headers.location).toBe('/');
      const session = ([] as string[])
        .concat(response.headers['set-cookie'] ?? [])
        .find((cookie) => cookie.startsWith('devdash_session='));
      const me = await http().get('/api/me').set('Cookie', String(session).split(';')[0] ?? '').expect(200);
      expect(me.body.mustChangePassword).toBe(true);
    });

    it('has no invitation routes left', async () => {
      await http().post('/api/team/invitations').set('Cookie', admin).send({}).expect(404);
      await http().get('/api/invitations').expect(404);
      await http().post('/api/invitations/accept').send({}).expect(404);
    });
  });

  it('changes a role straight away', async () => {
    const email = newEmail();
    const cookie = await join(email, 'viewer');
    await http().put(`/api/team/members/${await memberId(email)}`).set('Cookie', admin).send({ roleId: roleIds.developer }).expect(204);
    const me = await http().get('/api/me').set('Cookie', cookie);
    expect(me.body.roleName).toBe('Developer');
  });

  it('removes someone from the project but keeps their sign-in', async () => {
    const email = newEmail();
    const cookie = await join(email);
    await context.owner.updateTable('accounts').set({ totp_enabled_at: new Date() }).where('email', '=', email).execute();
    await http().delete(`/api/team/members/${await memberId(email)}`).set('Cookie', admin).expect(204);
    const me = await http().get('/api/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({ tenant: null, permissions: [] });
    const refused = await http().get('/api/cloud/accounts').set('Cookie', cookie).expect(403);
    expect(refused.body.message).toBe("You haven't been added to a project yet. Ask your super admin to add you.");
    await login(email, PASSWORD).expect(200);
  });

  it('removes someone from the pool and ends their sessions', async () => {
    const email = newEmail();
    const cookie = await join(email);
    await removeFromPool(email);
    await http().get('/api/me').set('Cookie', cookie).expect(401);
    await login(email, PASSWORD).expect(401);
  });

  it('protects the super admin from being changed or removed', async () => {
    const demote = await http().put(`/api/team/members/${adminId}`).set('Cookie', admin).send({ roleId: roleIds.viewer });
    expect(demote.status).toBe(409);
    expect(demote.body.message).toBe('The super admin always has full access.');
    await http().delete(`/api/team/members/${adminId}`).set('Cookie', admin).expect(409);
  });

  it('hands super admin to anyone, by the super admin only', async () => {
    const nextAdmin = await signIn(context, context.acme, user('next', 'admin'));
    const superAdmin = (id: string, cookie: string) => http().post(`/api/people/${id}/super-admin`).set('Cookie', cookie);

    await superAdmin(await accountId('ada@example.test'), nextAdmin).expect(403);
    await superAdmin(await accountId('next@example.test'), admin).expect(204);

    const { body } = await http().get('/api/team').set('Cookie', admin).expect(200);
    const owners = body.members.filter(({ isOwner }: { isOwner: boolean }) => isOwner);
    expect(owners.map(({ email }: { email: string }) => email)).toEqual(['next@example.test']);
    await superAdmin(await accountId('ada@example.test'), nextAdmin).expect(204);
  });

  describe('only the owner manages people', () => {
    let otherAdmin: string;
    let memberIdValue: string;
    let memberAccountId: string;

    beforeAll(async () => {
      otherAdmin = await signIn(context, context.acme, user('other-admin', 'admin'));
      const memberEmail = newEmail();
      await addOk(memberEmail);
      memberIdValue = await memberId(memberEmail);
      memberAccountId = await accountId(memberEmail);
    });

    it('lets other Admins read the team', async () => {
      const { body } = await http().get('/api/team').set('Cookie', otherAdmin).expect(200);
      expect(body.members.length).toBeGreaterThan(1);
    });

    it('refuses every change from another Admin, and records it', async () => {
      const member = `/api/team/members/${memberIdValue}`;
      const attempts = [
        () => http().post('/api/people').send({ firstName: 'New', lastName: 'Person', email: newEmail() }),
        () => http().put(member).send({ roleId: roleIds.viewer }),
        () => http().delete(member),
        () => http().post(`/api/people/${memberAccountId}/super-admin`),
      ];
      for (const attempt of attempts) {
        await attempt().set('Cookie', otherAdmin).expect(403);
      }
      const denied = await context.owner
        .selectFrom('audit_events')
        .select('metadata')
        .where('action', '=', 'access.denied')
        .where('actor_email', '=', 'other-admin@example.test')
        .execute();
      expect(denied).toHaveLength(attempts.length);
      expect(denied[0]?.metadata).toMatchObject({ required: 'owner', role: 'Admin' });
    });

    it('refuses changes from people who are not Admins', async () => {
      const developer = await signIn(context, context.acme, user('dev-b', 'developer'));
      await http().get('/api/team').set('Cookie', developer).expect(403);
      await http().delete(`/api/team/members/${memberIdValue}`).set('Cookie', developer).expect(403);
    });
  });

  describe('temporary passwords', () => {
    const NEW_PASSWORD = 'a brand new passphrase';
    const added = async (role: TestRole = 'developer') => {
      const email = newEmail();
      const { body } = await addOk(email, role);
      return { email, password: body.password as string, expiresAt: body.expiresAt as string };
    };
    const account = (email: string) =>
      context.owner.selectFrom('accounts').selectAll().where('email', '=', email).executeTakeFirstOrThrow();

    it('lasts a day and is stored hashed', async () => {
      const { email, password, expiresAt } = await added();
      expect(password.length).toBeGreaterThanOrEqual(24);
      expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
      const row = await account(email);
      expect(row.password_hash).toMatch(/^\$argon2id\$/);
      expect(row.password_hash).not.toContain(password);
    });

    it('allows nothing until the new password is chosen', async () => {
      const { email, password } = await added();
      const cookie = cookieFrom(await login(email, password).expect(200));

      const me = await http().get('/api/me').set('Cookie', cookie).expect(200);
      expect(me.body.mustChangePassword).toBe(true);
      const blocked = await http().get('/api/cloud/accounts').set('Cookie', cookie);
      expect(blocked.status).toBe(403);
      expect(blocked.body.message).toBe('Choose a new password to continue.');
      await http()
        .put('/api/account/password')
        .set('Cookie', cookie)
        .send({ currentPassword: password, newPassword: NEW_PASSWORD })
        .expect(403);

      const same = await replace(cookie, password);
      expect(same.status).toBe(400);
      expect(same.body.message).toBe('Choose a different password from the temporary one.');
      await replace(cookie, 'short').expect(400);
      await replace(cookie, LEAKED_PASSWORD).expect(400);

      await replace(cookie, NEW_PASSWORD).expect(204);
      await login(email, password).expect(401);
      const again = await login(email, NEW_PASSWORD).expect(200);
      const after = await http().get('/api/me').set('Cookie', cookieFrom(again)).expect(200);
      expect(after.body.mustChangePassword).toBe(false);
      await replace(cookieFrom(again), 'yet another passphrase').expect(409);
    });

    it('refuses an expired temporary password', async () => {
      const { email, password } = await added();
      await context.owner
        .updateTable('accounts')
        .set({ temporary_password_expires_at: new Date(Date.now() - 1000) })
        .where('email', '=', email)
        .execute();
      const response = await login(email, password);
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('This temporary password has expired. Ask your super admin to add you again.');
    });

    it('sends people on to two-factor after the new password', async () => {
      const { email, password } = await added('admin');
      const cookie = cookieFrom(await login(email, password).expect(200));
      await replace(cookie, NEW_PASSWORD).expect(204);
      const blocked = await http().get('/api/cloud/accounts').set('Cookie', cookie);
      expect(blocked.status).toBe(403);
      expect(blocked.body.message).toBe('Turn on two-factor authentication to continue.');
    });

    it('lets a locked-out person back in by removing and adding them again', async () => {
      const email = newEmail();
      await join(email);
      const session = cookieFrom(await login(email, PASSWORD).expect(200));
      await context.owner
        .updateTable('accounts')
        .set({
          totp_secret: 'encrypted',
          totp_enabled_at: new Date(),
          totp_last_step: 5,
          backup_codes: ['hashed'],
          locked_until: new Date(Date.now() + 60_000),
          failed_attempts: 3,
        })
        .where('email', '=', email)
        .execute();

      await removeFromPool(email);
      await http().get('/api/me').set('Cookie', session).expect(401);

      const { body } = await addOk(email);
      const response = await login(email, body.password).expect(200);
      expect(response.body.twoFactorRequired).toBe(false);
      expect(await account(email)).toMatchObject({
        totp_secret: null,
        totp_enabled_at: null,
        locked_until: null,
        failed_attempts: 0,
      });
    });

    it('has no way to reset an existing person', async () => {
      const email = newEmail();
      await join(email);
      await http()
        .post(`/api/team/members/${await memberId(email)}/temporary-password`)
        .set('Cookie', admin)
        .expect(404);
    });
  });

  it('keeps teams inside their workspace', async () => {
    await http().put(`/api/team/members/${adminId}`).set('Cookie', other).send({ roleId: roleIds.viewer }).expect(404);
    const { body } = await http().get('/api/team').set('Cookie', other).expect(200);
    const emails = body.members.map(({ email }: { email: string }) => email);
    expect(emails).toContain('ada@example.test');
    expect(emails).not.toContain('val@example.test');
    expect(emails.some((email: string) => email.startsWith('member'))).toBe(false);
  });
});
