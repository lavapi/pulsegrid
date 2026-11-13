import { GetScheduleCommand, ListSchedulesCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { mockClient } from 'aws-sdk-client-mock';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newTotpSecret } from '../src/auth/two-factor/totp';
import { MESSAGES } from '../src/database-access/database-access-errors';
import { WORKFLOW_POLL } from '../src/database-access/database-access-tenants';
import { DatabaseAccessJobs } from '../src/database-access/database-access.jobs';
import { DatabaseAccessQueue } from '../src/database-access/database-access.queue';
import { DATABASE_ACCESS_SETUP, loadDatabaseAccessSetup } from '../src/database-access/database-access.settings';
import { TenantDatabase } from '../src/database/tenant-database';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { TokenCipher } from '../src/inventory/connection/token-cipher';
import { setExtraPermissions, signIn, startTestApp, type TestContext, user } from './support/test-app';

const ACCOUNT = '860000000001';
const GRANT_ARN = `arn:aws:states:eu-central-1:${ACCOUNT}:stateMachine:db-access-grant`;
const REVOKE_ARN = `arn:aws:states:eu-central-1:${ACCOUNT}:stateMachine:db-access-revoke`;
const SETUP = loadDatabaseAccessSetup({
  DB_ACCESS_GRANT_STATE_MACHINE_ARN: GRANT_ARN,
  DB_ACCESS_REVOKE_STATE_MACHINE_ARN: REVOKE_ARN,
  DB_ACCESS_SCHEDULE_GROUP: 'db-access',
  DB_ACCESS_SSO_START_URL: 'https://example.awsapps.com/start',
  DB_ACCESS_TUNNEL_INSTANCE_ID: 'i-0abc',
  DB_ACCESS_READER_ENDPOINT: 'db.cluster-ro-x.eu-central-1.rds.amazonaws.com',
  DB_ACCESS_DATABASE: 'game',
});
const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'a'.repeat(40) };
const USER = 'pat@example.test';
const HOUR = 3_600_000;

const sfn = mockClient(SFNClient);
const scheduler = mockClient(SchedulerClient);
const queue = { follow: vi.fn(), expireAt: vi.fn(), cancelExpiry: vi.fn(), scheduleReconcile: vi.fn(), close: vi.fn() };

/** The workflow run ends the way the test says, and reports the end time it was given. */
const runEnds = (status: string, extra: { error?: string; output?: object } = {}) => {
  let input: { userName?: string; expiresAt?: string } = {};
  sfn.on(StartExecutionCommand).callsFake(({ input: given }: { input: string }) => {
    input = JSON.parse(given) as typeof input;
    return { executionArn: `arn:exec:${Date.now()}` };
  });
  sfn.on(DescribeExecutionCommand).callsFake(() => ({
    status,
    error: extra.error,
    output:
      status === 'SUCCEEDED'
        ? JSON.stringify(
            extra.output ?? {
              userName: input.userName,
              userId: 'u1',
              expiresAt: input.expiresAt,
              signInsStopped: true,
            },
          )
        : undefined,
  }));
};

describe('database access', () => {
  let context: TestContext;
  let granter: string;
  let viewer: string;
  let granterAccount: string;
  let secret: string;
  const http = () => request(context.app.getHttpServer());
  const jobs = () => context.app.get(DatabaseAccessJobs);
  const tenantId = () => context.acme.tenant.id;

  /** A code for now; the last used step is cleared so each step of a test can use one. */
  const freshCode = async () => {
    await context.owner
      .updateTable('accounts')
      .set({ totp_last_step: null })
      .where('id', '=', granterAccount)
      .execute();
    return new TOTP({ secret: Secret.fromBase32(secret), period: 30 }).generate();
  };
  const post = async (path: string, body: Record<string, unknown>) =>
    http()
      .post(`/api/database-access${path}`)
      .set('Cookie', granter)
      .send({ code: await freshCode(), ...body });
  const grant = (body: Record<string, unknown> = {}) =>
    post('/grants', { userName: USER, hours: 2, reason: 'Check a stuck payout', ...body });
  const row = (id: string) =>
    context.owner.selectFrom('database_access_grants').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  const actions = async (id: string) =>
    (
      await context.owner
        .selectFrom('audit_events')
        .select('action')
        .where('target_id', '=', id)
        .orderBy('occurred_at')
        .execute()
    ).map(({ action }) => action);
  const follow = (grantId: string, kind: 'grant' | 'extend' | 'revoke') =>
    jobs().follow({ tenantId: tenantId(), grantId, kind });

  /** An active grant made through the page, as the tests' starting point. */
  const activeGrant = async (hours = 2, userName = USER) => {
    runEnds('SUCCEEDED');
    const { body } = await grant({ hours, userName });
    await follow(body.id, 'grant');
    return row(body.id);
  };

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
    granter = await signIn(context, context.acme, user('gus', 'developer'));
    viewer = await signIn(context, context.acme, user('vic', 'viewer'));
    const account = await context.owner
      .selectFrom('accounts')
      .select('id')
      .where('email', '=', 'gus@example.test')
      .executeTakeFirstOrThrow();
    granterAccount = account.id;
    secret = newTotpSecret();
    await context.owner
      .updateTable('accounts')
      .set({ totp_secret: context.app.get(TokenCipher).encrypt(secret, `totp:${account.id}`) })
      .where('id', '=', account.id)
      .execute();
    const production = { tenant_id: tenantId(), provider: 'aws', account_id: ACCOUNT };
    await context.owner
      .insertInto('cloud_accounts')
      .values({
        ...production,
        name: 'Production',
        regions: ['eu-central-1'],
        encrypted_credentials: context.app.get(CredentialVault).seal(production, KEY),
      })
      .execute();
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    vi.clearAllMocks();
    sfn.reset();
    scheduler.reset();
    await context.owner.deleteFrom('database_access_grants').execute();
    await setExtraPermissions(context, context.acme, 'developer', ['production.database_access.grant']);
  });

  it('grants access through the grant workflow, then records it once AWS is done', async () => {
    runEnds('SUCCEEDED');
    const { body, status } = await grant();
    expect(status).toBe(201);
    expect(body).toMatchObject({ userName: USER, status: 'granting', reason: 'Check a stuck payout' });
    const started = sfn.commandCalls(StartExecutionCommand)[0]?.args[0].input;
    expect(started?.stateMachineArn).toBe(GRANT_ARN);
    const input = JSON.parse(started?.input ?? '{}');
    expect(input.userName).toBe(USER);
    expect(Date.parse(input.expiresAt) - Date.now()).toBeGreaterThan(2 * HOUR - 10_000);
    expect(queue.follow).toHaveBeenCalledWith({ tenantId: tenantId(), grantId: body.id, kind: 'grant' });

    await follow(body.id, 'grant');
    const saved = await row(body.id);
    expect(saved).toMatchObject({ status: 'active', user_id: 'u1', execution_arn: null, failure: null });
    expect(saved.expires_at.toISOString()).toBe(input.expiresAt);
    expect(queue.expireAt).toHaveBeenCalledWith({ tenantId: tenantId(), grantId: body.id }, saved.expires_at);
    expect(await actions(body.id)).toEqual(['database_access.grant_requested', 'database_access.granted']);
  });

  it.each([
    ['NotAllowed', 'FAILED', MESSAGES.notAllowed],
    ['UserNotFound', 'FAILED', MESSAGES.userNotFound],
    ['BadExpiry', 'FAILED', MESSAGES.badExpiry],
    ['AssignmentFailed', 'FAILED', MESSAGES.retry],
    ['States.Runtime', 'FAILED', MESSAGES.retry],
    [undefined, 'TIMED_OUT', MESSAGES.retry],
  ])('turns %s (%s) into a readable failure, with nothing active', async (error, status, message) => {
    runEnds(status, { error });
    const { body } = await grant();
    await follow(body.id, 'grant');
    expect(await row(body.id)).toMatchObject({ status: 'failed', failure: message });
    const { body: page } = await http().get('/api/database-access').set('Cookie', granter).expect(200);
    expect(page.grants).toEqual([]);
    expect(await actions(body.id)).toContain('database_access.grant_failed');
  });

  it("says when the Production key isn't allowed to start the workflow, without AWS text", async () => {
    sfn.on(StartExecutionCommand).rejects(Object.assign(new Error('raw aws text'), { name: 'AccessDeniedException' }));
    const { status, body } = await grant();
    expect(status).toBe(409);
    expect(body.message).toBe(MESSAGES.keyNotAllowed);
    const [saved] = await context.owner.selectFrom('database_access_grants').selectAll().execute();
    expect(saved).toMatchObject({ status: 'failed', failure: MESSAGES.keyNotAllowed });
  });

  it('extends by starting the grant workflow again, and keeps the old end when that fails', async () => {
    const grantRow = await activeGrant(2);
    runEnds('SUCCEEDED');
    const { status } = await post(`/grants/${grantRow.id}/extend`, { hours: 3 });
    expect(status).toBe(201);
    expect((await row(grantRow.id)).change).toBe('extending');
    const input = JSON.parse(sfn.commandCalls(StartExecutionCommand).at(-1)?.args[0].input.input ?? '{}');
    expect(Date.parse(input.expiresAt) - grantRow.expires_at.getTime()).toBe(3 * HOUR);
    await follow(grantRow.id, 'extend');
    const extended = await row(grantRow.id);
    expect(extended).toMatchObject({ status: 'active', change: null });
    expect(extended.expires_at.toISOString()).toBe(input.expiresAt);
    expect(queue.expireAt).toHaveBeenLastCalledWith(
      { tenantId: tenantId(), grantId: grantRow.id },
      extended.expires_at,
    );

    runEnds('FAILED', { error: 'BadExpiry' });
    await post(`/grants/${grantRow.id}/extend`, { hours: 1 });
    await follow(grantRow.id, 'extend');
    expect(await row(grantRow.id)).toMatchObject({
      change: null,
      failure: MESSAGES.badExpiry,
      expires_at: extended.expires_at,
    });
    expect(await actions(grantRow.id)).toContain('database_access.extend_failed');

    runEnds('SUCCEEDED');
    const atCap = await post(`/grants/${grantRow.id}/extend`, { hours: 8 });
    expect(atCap.status).toBe(201);
    await follow(grantRow.id, 'extend');
    const capped = await post(`/grants/${grantRow.id}/extend`, { hours: 1 });
    expect(capped.status).toBe(400);
    expect(capped.body.message).toBe('Access can last at most 8 hours from now.');
  });

  it('revokes once, even when asked twice and when the expiry job fires after', async () => {
    const grantRow = await activeGrant();
    runEnds('SUCCEEDED');
    expect((await post(`/grants/${grantRow.id}/revoke`, {})).status).toBe(201);
    const second = await post(`/grants/${grantRow.id}/revoke`, {});
    expect(second.status).toBe(409);
    expect(second.body.message).toBe('A change to this access is still running. Wait for it to finish.');
    expect(sfn.commandCalls(StartExecutionCommand).at(-1)?.args[0].input).toMatchObject({
      stateMachineArn: REVOKE_ARN,
      input: JSON.stringify({ userName: USER }),
    });

    await follow(grantRow.id, 'revoke');
    await follow(grantRow.id, 'revoke');
    await jobs().expire({ tenantId: tenantId(), grantId: grantRow.id });
    expect(await row(grantRow.id)).toMatchObject({
      status: 'revoked',
      end_reason: 'manual',
      revoked_by_email: 'gus@example.test',
    });
    expect(queue.cancelExpiry).toHaveBeenCalledWith(grantRow.id);
    expect((await actions(grantRow.id)).filter((action) => action === 'database_access.revoked')).toHaveLength(1);
    expect((await post(`/grants/${grantRow.id}/revoke`, {})).body.message).toBe('Only active access can be changed.');
  });

  it('ends access at its end time, and leaves access that was extended meanwhile', async () => {
    const grantRow = await activeGrant();
    await jobs().expire({ tenantId: tenantId(), grantId: grantRow.id });
    expect((await row(grantRow.id)).status).toBe('active');

    await context.owner
      .updateTable('database_access_grants')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('id', '=', grantRow.id)
      .execute();
    runEnds('SUCCEEDED');
    await jobs().expire({ tenantId: tenantId(), grantId: grantRow.id });
    expect(await row(grantRow.id)).toMatchObject({ status: 'expired', end_reason: 'expired', failure: null });
    expect(sfn.commandCalls(StartExecutionCommand).at(-1)?.args[0].input.stateMachineArn).toBe(REVOKE_ARN);
    expect(await actions(grantRow.id)).toContain('database_access.expired');
  });

  it('shows access granted outside PulseGrid without removing it, and marks ended grants expired', async () => {
    const active = await activeGrant();
    const ended = await activeGrant(2, 'sam@example.test');
    await context.owner
      .updateTable('database_access_grants')
      .set({ user_id: 'u2', expires_at: new Date(Date.now() - 60_000) })
      .where('id', '=', ended.id)
      .execute();
    scheduler.on(ListSchedulesCommand).resolves({ Schedules: [{ Name: 'db-access-u1' }, { Name: 'db-access-u9' }] });
    scheduler.on(GetScheduleCommand).callsFake(({ Name }: { Name: string }) => ({
      Name,
      ScheduleExpression: Name === 'db-access-u9' ? 'at(2026-11-13T18:30:00)' : 'at(2026-11-13T12:00:00)',
      ScheduleExpressionTimezone: 'UTC',
    }));
    sfn.resetHistory();
    await jobs().reconcile();
    expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(0);
    expect(scheduler.commandCalls(ListSchedulesCommand)[0]?.args[0].input).toMatchObject({ GroupName: 'db-access' });
    expect(await row(ended.id)).toMatchObject({ status: 'expired', end_reason: 'expired' });
    expect((await row(active.id)).status).toBe('active');
    const { body } = await http().get('/api/database-access').set('Cookie', granter).expect(200);
    expect(body.outside).toEqual([{ userId: 'u9', expiresAt: '2026-11-13T18:30:00.000Z' }]);
    expect(body.outsideCheckedAt).toEqual(expect.any(String));
  });

  it('refuses a second grant for the same person, a wrong code, bad hours and no reason', async () => {
    runEnds('SUCCEEDED');
    expect((await grant()).status).toBe(201);
    const twice = await grant({ userName: USER.toUpperCase() });
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe(`${USER.toUpperCase()} already has database access. Extend it instead.`);
    await context.owner.deleteFrom('database_access_grants').execute();
    const wrong = await grant({ code: '000000' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.message).toBe('That code is incorrect.');
    expect((await grant({ hours: 9 })).body.message).toBe('Choose between 1 and 8 hours.');
    expect((await grant({ reason: '  ' })).status).toBe(400);
    expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(1);
  });

  it('needs the production permission', async () => {
    await http().get('/api/database-access').set('Cookie', viewer).expect(403);
    await http().post('/api/database-access/grants').set('Cookie', viewer).send({}).expect(403);
    await setExtraPermissions(context, context.acme, 'developer', []);
    await http().get('/api/database-access/history').set('Cookie', granter).expect(403);
    expect(sfn.commandCalls(StartExecutionCommand)).toHaveLength(0);
  });

  it('shows the connect steps in the project with the Production account only', async () => {
    const { body } = await http().get('/api/database-access').set('Cookie', granter).expect(200);
    expect(body).toMatchObject({
      ready: true,
      maxHours: 8,
      missingConnect: [],
      connect: {
        accountId: ACCOUNT,
        region: 'eu-central-1',
        localPort: 15432,
        user: 'readonly_access',
        database: 'game',
      },
    });
    const other = await signIn(context, context.globex, user('gia', 'admin'));
    const elsewhere = await http().get('/api/database-access').set('Cookie', other).expect(200);
    expect(elsewhere.body).toEqual({
      ready: false,
      problems: [`Connect AWS account ${ACCOUNT} to this project to grant access to it.`],
    });
  });

  describe('the grants table', () => {
    const insert = (tenant: string, status: string, userName = USER) =>
      context.owner
        .insertInto('database_access_grants')
        .values({
          tenant_id: tenant,
          granted_by_email: 'gus@example.test',
          user_name: userName,
          reason: 'Check',
          status: status as 'active',
          expires_at: new Date(Date.now() + HOUR),
        })
        .execute();

    it('allows one open grant per user name, whatever its case, and any number that ended', async () => {
      await insert(tenantId(), 'revoked');
      await insert(tenantId(), 'expired');
      await insert(tenantId(), 'failed');
      await insert(tenantId(), 'active');
      await expect(insert(tenantId(), 'granting', USER.toUpperCase())).rejects.toThrow(
        /database_access_grants_one_open/,
      );
    });

    it('keeps each project to its own grants', async () => {
      await insert(tenantId(), 'active');
      const seen = await context.app
        .get(TenantDatabase)
        .run(context.globex.tenant.id, (trx) => trx.selectFrom('database_access_grants').select('id').execute());
      expect(seen).toEqual([]);
    });
  });
});
