import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roleId, signIn, startTestApp, type TestContext, user } from './support/test-app';

const PASSWORD = 'correct horse battery';
const NO_PROJECT = "You haven't been added to a project yet. Ask your super admin to add you.";

describe('projects and the people pool', () => {
  let context: TestContext;
  let superAdmin: string;
  let admin: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());
  const newEmail = () => `pool${(sequence += 1)}@example.test`;
  const cookieFrom = (response: request.Response) => String(response.headers['set-cookie']).split(';')[0] ?? '';

  const addToPool = async (email: string) => {
    const { body } = await http()
      .post('/api/people')
      .set('Cookie', superAdmin)
      .send({ firstName: 'Pool', lastName: 'Person', email })
      .expect(201);
    const cookie = cookieFrom(await http().post('/api/auth/sign-in').send({ email, password: body.password }).expect(200));
    await http().post('/api/account/password/temporary').set('Cookie', cookie).send({ newPassword: PASSWORD }).expect(204);
    await twoFactor(email, true);
    const account = await context.owner.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow();
    return { cookie, accountId: account.id };
  };
  const twoFactor = (email: string, on: boolean) =>
    context.owner.updateTable('accounts').set({ totp_enabled_at: on ? new Date() : null }).where('email', '=', email).execute();
  const signInAgain = async (email: string) => {
    await twoFactor(email, false);
    const cookie = cookieFrom(await http().post('/api/auth/sign-in').send({ email, password: PASSWORD }).expect(200));
    await twoFactor(email, true);
    return cookie;
  };
  const assign = async (accountId: string, role: 'viewer' | 'developer' = 'viewer', cookie = superAdmin) =>
    http().post('/api/team/assignments').set('Cookie', cookie).send({ accountId, roleId: await roleId(context, context.acme, role) });
  const projects = async (cookie: string) => (await http().get('/api/projects').set('Cookie', cookie).expect(200)).body;

  beforeAll(async () => {
    context = await startTestApp();
    superAdmin = await signIn(context, context.acme, user('ada', 'admin'));
    admin = await signIn(context, context.acme, user('second', 'admin'));
  });
  afterAll(() => context.close());

  it('keeps someone in the pool out of every project until they are assigned', async () => {
    const { cookie } = await addToPool(newEmail());
    const me = await http().get('/api/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({ tenant: null, permissions: [], isOwner: false });
    expect(await projects(cookie)).toEqual({ currentId: null, projects: [] });

    for (const path of ['/api/cloud/accounts', '/api/environments', '/api/team', '/api/releases']) {
      const response = await http().get(path).set('Cookie', cookie).expect(403);
      expect(response.body.message).toBe(NO_PROJECT);
    }
    await http().post(`/api/projects/${context.acme.tenant.id}/select`).set('Cookie', cookie).expect(404);
    await http().post(`/api/projects/${context.globex.tenant.id}/select`).set('Cookie', cookie).expect(404);
    await http().get('/api/account').set('Cookie', cookie).expect(200);
  });

  it('lets them in once assigned, with the role chosen for that project', async () => {
    const email = newEmail();
    const { accountId } = await addToPool(email);
    expect((await assign(accountId)).status).toBe(204);
    const cookie = await signInAgain(email);
    const me = await http().get('/api/me').set('Cookie', cookie).expect(200);
    expect(me.body).toMatchObject({ tenant: { id: context.acme.tenant.id }, roleName: 'Viewer' });
    expect((await projects(cookie)).projects).toEqual([{ id: context.acme.tenant.id, name: 'ACME' }]);
    await http().post(`/api/projects/${context.globex.tenant.id}/select`).set('Cookie', cookie).expect(404);
    expect((await http().get('/api/me').set('Cookie', cookie)).body.tenant.id).toBe(context.acme.tenant.id);
  });

  it('refuses assigning the same person twice or someone who does not exist', async () => {
    const { accountId } = await addToPool(newEmail());
    expect((await assign(accountId)).status).toBe(204);
    const twice = await assign(accountId);
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe('That person is already in this project.');
    expect((await assign('00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('only lets the super admin manage the pool, assign people and create projects', async () => {
    const { accountId } = await addToPool(newEmail());
    await http().get('/api/people').set('Cookie', admin).expect(403);
    await http().post('/api/people').set('Cookie', admin).send({ firstName: 'A', lastName: 'B', email: newEmail() }).expect(403);
    expect((await assign(accountId, 'viewer', admin)).status).toBe(403);
    await http().post('/api/projects').set('Cookie', admin).send({ name: 'Side project' }).expect(403);
  });

  it('creates a project that only the super admin and assigned people can enter', async () => {
    const email = newEmail();
    const { accountId } = await addToPool(email);
    expect((await assign(accountId)).status).toBe(204);
    const member = await signInAgain(email);

    const { body: project } = await http().post('/api/projects').set('Cookie', superAdmin).send({ name: 'Payments' }).expect(201);
    expect(project.name).toBe('Payments');
    const me = await http().get('/api/me').set('Cookie', superAdmin).expect(200);
    expect(me.body.tenant).toMatchObject({ id: project.id, name: 'Payments' });
    const environments = await http().get('/api/environments/manage').set('Cookie', superAdmin).expect(200);
    expect(environments.body.environments.map(({ name }: { name: string }) => name).sort()).toEqual(['Production', 'Staging']);
    const team = await http().get('/api/team').set('Cookie', superAdmin).expect(200);
    expect(team.body.members.map(({ email: address }: { email: string }) => address)).toEqual(['ada@example.test']);

    await http().post(`/api/projects/${project.id}/select`).set('Cookie', member).expect(404);
    expect((await projects(member)).projects.map(({ id }: { id: string }) => id)).not.toContain(project.id);
    expect((await projects(superAdmin)).projects.map(({ id }: { id: string }) => id)).toEqual(
      expect.arrayContaining([context.acme.tenant.id, context.globex.tenant.id, project.id]),
    );
    await http().post(`/api/projects/${context.acme.tenant.id}/select`).set('Cookie', superAdmin).expect(204);
  });

  it('shows each person with their projects and roles', async () => {
    const email = newEmail();
    const { accountId } = await addToPool(email);
    expect((await assign(accountId, 'developer')).status).toBe(204);
    const { body } = await http().get('/api/people').set('Cookie', superAdmin).expect(200);
    expect(body.find(({ email: address }: { email: string }) => address === email)).toMatchObject({
      displayName: 'Pool Person',
      isSuperAdmin: false,
      twoFactorEnabled: true,
      pendingPassword: false,
      projects: [{ id: context.acme.tenant.id, name: 'ACME', roleName: 'Developer' }],
    });
  });

  it('sends a removed member back to no project, and their next sign-in too', async () => {
    const email = newEmail();
    const { accountId } = await addToPool(email);
    expect((await assign(accountId)).status).toBe(204);
    const cookie = await signInAgain(email);
    const team = await http().get('/api/team').set('Cookie', superAdmin).expect(200);
    const memberId = team.body.members.find(({ email: address }: { email: string }) => address === email).id;
    await http().delete(`/api/team/members/${memberId}`).set('Cookie', superAdmin).expect(204);

    expect((await http().get('/api/me').set('Cookie', cookie).expect(200)).body.tenant).toBeNull();
    const fresh = await signInAgain(email);
    expect((await http().get('/api/me').set('Cookie', fresh).expect(200)).body.tenant).toBeNull();
  });

  it('lets only the super admin rename the open project', async () => {
    await http().put('/api/projects/current').set('Cookie', admin).send({ name: 'Hijack' }).expect(403);
    await http().put('/api/projects/current').set('Cookie', superAdmin).send({ name: ' ' }).expect(400);
    const { body } = await http().put('/api/projects/current').set('Cookie', superAdmin).send({ name: 'Acme Prime' }).expect(200);
    expect(body).toEqual({ id: context.acme.tenant.id, name: 'Acme Prime' });
    const me = await http().get('/api/me').set('Cookie', admin).expect(200);
    expect(me.body.tenant.name).toBe('Acme Prime');
    const audit = await http().get('/api/audit-events').set('Cookie', superAdmin).expect(200);
    expect(audit.body.events[0]).toMatchObject({ action: 'project.renamed', metadata: { label: 'Acme Prime', previous: 'ACME' } });
    await http().put('/api/projects/current').set('Cookie', superAdmin).send({ name: 'ACME' }).expect(200);
  });

  it('deletes a project with everything in it, once its name is typed', async () => {
    const email = newEmail();
    const { accountId } = await addToPool(email);
    const { body: project } = await http().post('/api/projects').set('Cookie', superAdmin).send({ name: 'Throwaway' }).expect(201);
    const roleIdIn = (await context.owner.selectFrom('roles').select('id').where('tenant_id', '=', project.id).where('name', '=', 'Viewer').executeTakeFirstOrThrow()).id;
    await http().post('/api/team/assignments').set('Cookie', superAdmin).send({ accountId, roleId: roleIdIn }).expect(204);
    const member = await signInAgain(email);
    expect((await http().get('/api/me').set('Cookie', member)).body.tenant.id).toBe(project.id);

    await http().delete('/api/projects/current').set('Cookie', member).send({ confirmName: 'Throwaway' }).expect(403);
    const wrong = await http().delete('/api/projects/current').set('Cookie', superAdmin).send({ confirmName: 'throwaway' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toBe("The name you typed doesn't match this project.");
    await http().delete('/api/projects/current').set('Cookie', superAdmin).send({ confirmName: 'Throwaway' }).expect(204);

    for (const table of ['users', 'roles', 'environments', 'audit_events'] as const) {
      const rows = await context.owner.selectFrom(table).select('tenant_id').where('tenant_id', '=', project.id).execute();
      expect(rows).toEqual([]);
    }
    const me = (await http().get('/api/me').set('Cookie', superAdmin).expect(200)).body;
    expect(me.tenant.id).not.toBe(project.id);
    const memberNow = await http().get('/api/me').set('Cookie', member).expect(200);
    expect(memberNow.body.tenant).toBeNull();
    const deleted = await http().get('/api/audit-events').set('Cookie', superAdmin).expect(200);
    expect(deleted.body.events[0]).toMatchObject({ action: 'project.deleted', metadata: { label: 'Throwaway' } });
    await http().post(`/api/projects/${context.acme.tenant.id}/select`).set('Cookie', superAdmin).expect(204);
  });

  it('refuses to delete the only project', async () => {
    const { body } = await http().get('/api/projects').set('Cookie', superAdmin).expect(200);
    for (const project of body.projects.filter(({ id }: { id: string }) => id !== context.acme.tenant.id)) {
      await http().post(`/api/projects/${project.id}/select`).set('Cookie', superAdmin).expect(204);
      await http().delete('/api/projects/current').set('Cookie', superAdmin).send({ confirmName: project.name }).expect(204);
    }
    await http().post(`/api/projects/${context.acme.tenant.id}/select`).set('Cookie', superAdmin).expect(204);
    const last = await http().delete('/api/projects/current').set('Cookie', superAdmin).send({ confirmName: 'ACME' });
    expect(last.status).toBe(409);
    expect(last.body.message).toBe("You can't delete the only project. Create another one first.");
  });

  it('keeps sessions from the cookie format used before projects', async () => {
    const [name, token] = superAdmin.split('=');
    const legacy = `${name}=${context.acme.tenant.id}.${token}`;
    await http().get('/api/me').set('Cookie', legacy).expect(200);
  });
});
