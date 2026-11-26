import { StartExecutionCommand } from '@aws-sdk/client-sfn';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKFLOW_POLL } from '../src/database-access/database-access-tenants';
import { DatabaseAccessJobs } from '../src/database-access/database-access.jobs';
import { DatabaseAccessQueue } from '../src/database-access/database-access.queue';
import { DATABASE_ACCESS_SETUP } from '../src/database-access/database-access.settings';
import { authenticatorFor, connectProduction, runEnds, SETUP, sfn } from './support/database-access';
import { setExtraPermissions, signIn, startTestApp, type TestContext, user } from './support/test-app';

const queue = { follow: vi.fn(), expireAt: vi.fn(), cancelExpiry: vi.fn(), scheduleReconcile: vi.fn(), close: vi.fn() };
const ASK = { userName: 'vic@example.test', hours: 2, reason: 'Check a stuck payout' };

describe('database access requests', () => {
  let context: TestContext;
  let approver: string;
  let requester: string;
  let otherRequester: string;
  let otherProject: string;
  let freshCode: () => Promise<string>;
  const http = () => request(context.app.getHttpServer());
  const tenantId = () => context.acme.tenant.id;
  const ask = (cookie = requester, body: object = ASK) =>
    http().post('/api/database-access/requests').set('Cookie', cookie).send(body);
  const mine = async (cookie = requester) =>
    (await http().get('/api/database-access/mine').set('Cookie', cookie).expect(200)).body;
  const pending = async (cookie = approver) =>
    (await http().get('/api/database-access/requests').set('Cookie', cookie).expect(200)).body;
  const approve = async (id: string, status: number, body: object = {}) =>
    http()
      .post(`/api/database-access/requests/${id}/approve`)
      .set('Cookie', approver)
      .send({ hours: 2, code: await freshCode(), ...body })
      .expect(status);
  const decline = (id: string, reason: string | null = null) =>
    http().post(`/api/database-access/requests/${id}/decline`).set('Cookie', approver).send({ reason });
  const actions = async (id: string) =>
    (
      await context.owner.selectFrom('audit_events').select('action').where('target_id', '=', id).orderBy('occurred_at').execute()
    ).map(({ action }) => action);

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder
        .overrideProvider(DATABASE_ACCESS_SETUP)
        .useValue(SETUP)
        .overrideProvider(WORKFLOW_POLL)
        .useValue({ intervalMs: 0, timeoutMs: 1000 })
        .overrideProvider(DatabaseAccessQueue)
        .useValue(queue),
    );
    approver = await signIn(context, context.acme, user('gus', 'developer'));
    requester = await signIn(context, context.acme, user('vic', 'viewer'));
    otherRequester = await signIn(context, context.acme, user('rae', 'viewer'));
    otherProject = await signIn(context, context.globex, user('gia', 'developer'));
    freshCode = await authenticatorFor(context, 'gus@example.test');
    await connectProduction(context, context.acme);
    await setExtraPermissions(context, context.acme, 'developer', ['production.database_access.grant']);
    await setExtraPermissions(context, context.globex, 'developer', ['production.database_access.grant']);
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    vi.clearAllMocks();
    sfn.reset();
    await context.owner.deleteFrom('database_access_requests').execute();
    await context.owner.deleteFrom('database_access_grants').execute();
  });

  it('lets someone without the permission ask, suggesting their email, and shows approvers the request', async () => {
    expect(await mine()).toMatchObject({ ready: true, suggestedUserName: 'vic@example.test', request: null, grant: null });
    const { body } = await ask().expect(201);
    expect(body).toMatchObject({ ...ASK, requestedBy: 'vic', requestedByEmail: 'vic@example.test', status: 'pending' });
    expect(Date.parse(body.expiresAt) - Date.parse(body.createdAt)).toBe(24 * 3_600_000);

    expect(await pending()).toEqual([body]);
    expect((await http().get('/api/database-access/requests/waiting').set('Cookie', approver).expect(200)).body).toEqual({
      count: 1,
    });
    expect((await mine()).request).toEqual(body);
    expect(await actions(body.id)).toEqual(['database_access.access_requested']);
  });

  it('keeps the list and the answers to approvers', async () => {
    const { body } = await ask().expect(201);
    await http().get('/api/database-access/requests').set('Cookie', requester).expect(403);
    await http().get('/api/database-access/requests/waiting').set('Cookie', requester).expect(403);
    await http().post(`/api/database-access/requests/${body.id}/decline`).set('Cookie', otherRequester).send({}).expect(403);
  });

  it('allows one waiting request per person, which they can cancel and only they', async () => {
    const { body } = await ask().expect(201);
    expect((await ask().expect(409)).body.message).toBe('You already have a request waiting. Cancel it to ask again.');
    await ask(otherRequester, { ...ASK, userName: 'rae@example.test' }).expect(201);

    await http().post(`/api/database-access/requests/${body.id}/cancel`).set('Cookie', otherRequester).expect(409);
    const cancelled = await http().post(`/api/database-access/requests/${body.id}/cancel`).set('Cookie', requester).expect(201);
    expect(cancelled.body.status).toBe('cancelled');
    await ask().expect(201);
  });

  it('approves with a code by starting an ordinary grant for the requested user name', async () => {
    runEnds('SUCCEEDED');
    const { body } = await ask().expect(201);
    const { body: approved } = await approve(body.id, 201, { hours: 3 });
    expect(approved).toMatchObject({ status: 'approved', decidedBy: 'gus@example.test' });

    const input = JSON.parse(sfn.commandCalls(StartExecutionCommand)[0]?.args[0].input.input ?? '{}');
    expect(input.userName).toBe('vic@example.test');
    expect(Date.parse(input.expiresAt) - Date.now()).toBeGreaterThan(3 * 3_600_000 - 10_000);

    await context.app.get(DatabaseAccessJobs).follow({ tenantId: tenantId(), grantId: approved.grantId, kind: 'grant' });
    const view = await mine();
    expect(view.request.status).toBe('approved');
    expect(view.grant).toMatchObject({ id: approved.grantId, status: 'active', userName: 'vic@example.test', grantedBy: 'gus@example.test' });
    expect(view.connect).toMatchObject({ database: 'game' });
    expect(await pending()).toEqual([]);
    expect(await actions(body.id)).toEqual(['database_access.access_requested', 'database_access.request_approved']);
  });

  it('refuses a wrong code and a second answer, leaving the request as it was', async () => {
    runEnds('SUCCEEDED');
    const { body } = await ask().expect(201);
    await http()
      .post(`/api/database-access/requests/${body.id}/approve`)
      .set('Cookie', approver)
      .send({ hours: 2, code: '000000' })
      .expect(401);
    expect((await pending()).map(({ id }: { id: string }) => id)).toEqual([body.id]);

    await approve(body.id, 201);
    expect((await approve(body.id, 409)).body.message).toBe('Someone already answered this request.');
    expect((await decline(body.id).expect(409)).body.message).toBe('Someone already answered this request.');
  });

  it('puts the request back when AWS will not start the grant', async () => {
    sfn.on(StartExecutionCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    const { body } = await ask().expect(201);
    await approve(body.id, 409);
    expect((await pending()).map(({ id }: { id: string }) => id)).toEqual([body.id]);
  });

  it('declines with a reason the requester sees, and they can ask again', async () => {
    const { body } = await ask().expect(201);
    const { body: declined } = await decline(body.id, 'Use the staging copy').expect(201);
    expect(declined).toMatchObject({ status: 'declined', declineReason: 'Use the staging copy', decidedBy: 'gus@example.test' });
    expect((await mine()).request).toMatchObject({ status: 'declined', declineReason: 'Use the staging copy' });
    expect(await actions(body.id)).toEqual(['database_access.access_requested', 'database_access.request_declined']);
    await ask().expect(201);
  });

  it('refuses a request while the person already has access', async () => {
    runEnds('SUCCEEDED');
    const { body } = await ask().expect(201);
    await approve(body.id, 201);
    expect((await ask().expect(409)).body.message).toBe('You already have database access. Ask an approver to extend it.');
  });

  it('expires a request nobody answered within a day', async () => {
    const { body } = await ask().expect(201);
    await sql`update database_access_requests set created_at = now() - interval '25 hours' where id = ${body.id}`.execute(
      context.owner,
    );
    expect(await pending()).toEqual([]);
    expect((await mine()).request.status).toBe('expired');
    await approve(body.id, 409);
  });

  it('keeps requests inside their project, and is quiet where access is not set up', async () => {
    await ask().expect(201);
    expect(await pending(otherProject)).toEqual([]);
    expect(await mine(otherProject)).toEqual({
      ready: false,
      message: 'Database access is requested in the project that has the Production account connected.',
    });
    await ask(otherProject).expect(404);
  });
});
