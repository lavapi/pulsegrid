import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

describe('access control and audit', () => {
  let context: TestContext;
  let admin: string;
  let viewer: string;
  const http = () => request(context.app.getHttpServer());

  beforeAll(async () => {
    context = await startTestApp();
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
  });
  afterAll(() => context.close());

  it('blocks viewers from admin endpoints and audits the attempt', async () => {
    const response = await http().get('/api/team').set('Cookie', viewer);
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: 'You do not have permission to do that.' });

    const audit = await http().get('/api/audit-events').set('Cookie', admin);
    const denied = audit.body.events.find((event: { action: string }) => event.action === 'access.denied');
    expect(denied).toMatchObject({ actorEmail: 'val@example.test' });
  });

  describe('developers', () => {
    let developer: string;

    beforeAll(async () => {
      developer = await signIn(context, context.acme, user('dev', 'developer'));
    });

    it('can see activity, like admins', async () => {
      await http().get('/api/audit-events').set('Cookie', developer).expect(200);
      await http().get('/api/audit-events/actors').set('Cookie', developer).expect(200);
    });

    it('cannot see activity as a viewer', async () => {
      await http().get('/api/audit-events').set('Cookie', viewer).expect(403);
    });

    it.each([
      ['get', '/api/team'],
      ['post', '/api/people'],
      ['get', '/api/git/connections'],
      ['post', '/api/git/connections'],
      ['post', '/api/cloud/accounts'],
      ['post', '/api/cloud/accounts/check'],
      ['get', '/api/environments/manage'],
      ['post', '/api/environments'],
    ] as const)('cannot use %s %s', async (method, path) => {
      await http()[method](path).set('Cookie', developer).expect(403);
    });
  });

  it('records team changes', async () => {
    await http()
      .post('/api/people')
      .set('Cookie', admin)
      .send({ firstName: 'New', lastName: 'Person', email: 'new@example.test' })
      .expect(201);
    const audit = await http().get('/api/audit-events').set('Cookie', admin);
    expect(audit.body.events[0].action).toBe('people.added');
  });

  it('pages through the audit log', async () => {
    for (const email of ['one@example.test', 'two@example.test', 'three@example.test']) {
      await http()
        .post('/api/people')
        .set('Cookie', admin)
        .send({ firstName: 'New', lastName: 'Person', email });
    }
    const first = await http().get('/api/audit-events?limit=2').set('Cookie', admin);
    expect(first.body.events).toHaveLength(2);
    const second = await http()
      .get(`/api/audit-events?limit=2&cursor=${first.body.nextCursor}`)
      .set('Cookie', admin);
    expect(Number(second.body.events[0].id)).toBeLessThan(Number(first.body.events[1].id));
  });

  it('filters audit events and lists who appears in them', async () => {
    await http()
      .post('/api/people')
      .set('Cookie', admin)
      .send({ firstName: 'New', lastName: 'Person', email: 'filter@example.test' });
    const email = 'ada@example.test';
    const { body } = await http()
      .get(`/api/audit-events?category=people&actor=${email}`)
      .set('Cookie', admin)
      .expect(200);
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.events.every(({ action }: { action: string }) => /^(team|people|project)\./.test(action))).toBe(true);

    const future = await http().get('/api/audit-events?from=2099-01-01').set('Cookie', admin).expect(200);
    expect(future.body.events).toEqual([]);
    await http().get('/api/audit-events?category=nope').set('Cookie', admin).expect(400);
    await http().get('/api/audit-events?category=constructor').set('Cookie', admin).expect(400);
    const actors = await http().get('/api/audit-events/actors').set('Cookie', admin).expect(200);
    expect(actors.body).toContain(email);
  });

  it('keeps audit events inside their tenant', async () => {
    const otherAdmin = await signIn(context, context.globex, user('gia', 'admin'));
    await http()
      .post('/api/people')
      .set('Cookie', otherAdmin)
      .send({ firstName: 'New', lastName: 'Person', email: 'four@example.test' });
    const { body } = await http().get('/api/audit-events').set('Cookie', otherAdmin);
    expect(body.events.map((event: { actorEmail: string }) => event.actorEmail)).toEqual(['gia@example.test']);
  });
});
