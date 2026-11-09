import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

describe('roles', () => {
  let context: TestContext;
  let owner: string;
  let admin: string;
  let viewer: string;
  let otherOwner: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());
  const newName = () => `Role ${(sequence += 1)}`;
  const list = (cookie = owner) => http().get('/api/roles').set('Cookie', cookie);
  const create = (body: object, cookie = owner) => http().post('/api/roles').set('Cookie', cookie).send(body);
  const added = async (name: string, permissions: string[] = []) => {
    await create({ name, permissions }).expect(204);
    const { body } = await list().expect(200);
    return body.find((role: { name: string }) => role.name === name) as { id: string };
  };

  beforeAll(async () => {
    context = await startTestApp();
    owner = await signIn(context, context.acme, user('ada', 'admin'));
    admin = await signIn(context, context.acme, user('second', 'admin'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    otherOwner = await signIn(context, context.globex, user('ada', 'admin'));
  });
  afterAll(() => context.close());

  it('lists roles with their people and permissions', async () => {
    const { body } = await list().expect(200);
    expect(body.find(({ name }: { name: string }) => name === 'Admin')).toMatchObject({
      memberCount: 2,
      permissions: expect.arrayContaining(['team.view']),
    });
    expect(body.find(({ name }: { name: string }) => name === 'Viewer')).toMatchObject({
      memberCount: 1,
      permissions: [],
    });
  });

  it('applies a role change to people straight away', async () => {
    const { body } = await list().expect(200);
    const role = body.find(({ name }: { name: string }) => name === 'Viewer');
    await http().get('/api/team').set('Cookie', viewer).expect(403);
    await http().put(`/api/roles/${role.id}`).set('Cookie', owner).send({ name: 'Viewer', permissions: ['team.view'] }).expect(204);
    await http().get('/api/team').set('Cookie', viewer).expect(200);
    await http().put(`/api/roles/${role.id}`).set('Cookie', owner).send({ name: 'Viewer', permissions: [] }).expect(204);
    await http().get('/api/team').set('Cookie', viewer).expect(403);
  });

  it('lets a custom role reach only what it was given', async () => {
    const { id } = await added(newName(), ['environments.manage']);
    const custom = await signIn(context, context.acme, user('custom', 'viewer'));
    const { body: self } = await http().get('/api/me').set('Cookie', custom).expect(200);
    await http().put(`/api/team/members/${self.id}`).set('Cookie', owner).send({ roleId: id }).expect(204);
    const me = await http().get('/api/me').set('Cookie', custom).expect(200);
    expect(me.body.permissions).toEqual(['environments.manage']);
    await http().get('/api/environments/manage').set('Cookie', custom).expect(200);
    await http().get('/api/git/connections').set('Cookie', custom).expect(403);
  });

  it('lets a role that manages integrations choose environments', async () => {
    const { id } = await added(newName(), ['integrations.manage']);
    const custom = await signIn(context, context.acme, user('connector', 'viewer'));
    const { body: self } = await http().get('/api/me').set('Cookie', custom).expect(200);
    await http().put(`/api/team/members/${self.id}`).set('Cookie', owner).send({ roleId: id }).expect(204);
    await http().get('/api/environments/manage').set('Cookie', custom).expect(200);
    await http().post('/api/environments').set('Cookie', custom).send({ name: 'Nope' }).expect(403);
  });

  it('gives the owner every permission whatever their role says', async () => {
    const { body } = await http().get('/api/me').set('Cookie', owner).expect(200);
    expect(body.permissions).toEqual(expect.arrayContaining(['secret.write', 'server.reboot', 'pipeline.run']));
  });

  it('refuses a blank name, unknown permissions and a taken name', async () => {
    await create({ name: ' ', permissions: [] }).expect(400);
    await create({ name: newName(), permissions: ['root.everything'] }).expect(400);
    await create({ name: newName(), permissions: ['constructor'] }).expect(400);
    const taken = await create({ name: 'admin', permissions: [] });
    expect(taken.status).toBe(409);
    expect(taken.body.message).toBe('A role with that name already exists.');
  });

  it('deletes a role only when nobody has it', async () => {
    const { body } = await list().expect(200);
    const inUse = body.find(({ name }: { name: string }) => name === 'Admin');
    const refused = await http().delete(`/api/roles/${inUse.id}`).set('Cookie', owner);
    expect(refused.status).toBe(409);
    expect(refused.body.message).toBe('Move everyone to another role first.');
    const { id } = await added(newName());
    await http().delete(`/api/roles/${id}`).set('Cookie', owner).expect(204);
    await http().delete(`/api/roles/${id}`).set('Cookie', owner).expect(404);
  });

  it('records changes', async () => {
    const name = newName();
    const { id } = await added(name, ['logs.read']);
    const events = await context.owner
      .selectFrom('audit_events')
      .select(['action', 'metadata'])
      .where('target_id', '=', id)
      .execute();
    expect(events).toEqual([
      { action: 'team.role_created', metadata: { label: name, permissions: ['logs.read'] } },
    ]);
  });

  it('only lets the owner change roles', async () => {
    const { id } = await added(newName());
    const body = { name: newName(), permissions: ['secret.write'] };
    await create(body, admin).expect(403);
    await http().put(`/api/roles/${id}`).set('Cookie', admin).send(body).expect(403);
    await http().delete(`/api/roles/${id}`).set('Cookie', admin).expect(403);
    await list(admin).expect(200);
    await list(viewer).expect(403);
  });

  it('keeps workspaces apart', async () => {
    const { id } = await added(newName());
    await http().put(`/api/roles/${id}`).set('Cookie', otherOwner).send({ name: newName(), permissions: [] }).expect(404);
    await http().delete(`/api/roles/${id}`).set('Cookie', otherOwner).expect(404);
    const { body } = await list(otherOwner).expect(200);
    expect(body.map(({ id: roleId }: { id: string }) => roleId)).not.toContain(id);
  });
});
