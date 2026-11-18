import { DynamoDBClient, GetItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PRODUCTION_CLIENTS } from '../src/production-releases/production-releases.aws';
import { setExtraPermissions, signIn, startTestApp, type TestContext, user } from './support/test-app';

const fake = { region: 'eu-central-1', credentials: { accessKeyId: 'test', secretAccessKey: 'test' } };
const dynamodb = new DynamoDBClient(fake);
const lambda = new LambdaClient(fake);
const tables = mockClient(dynamodb);
const functions = mockClient(lambda);

const RELEASE_ID = 'rel-20261118-0930';
const release = (fields: Record<string, string> = {}) => ({
  id: { S: RELEASE_ID },
  status: { S: 'HOLD' },
  tags: { S: JSON.stringify({ backend: 'main-1a2b3c4', 'frontend-next': 'main-9f8e7d6' }) },
  requested_by: { S: 'ada@example.test' },
  created_at: { S: '1794994200' },
  hold_started_at: { S: '1794994800' },
  hold_until: { S: '1795023600' },
  ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, { S: value }])),
});

const releaseInProgress = (item: ReturnType<typeof release> | null) => {
  tables
    .on(GetItemCommand, { Key: { id: { S: 'ACTIVE' } } })
    .resolves(item ? { Item: { id: { S: 'ACTIVE' }, release_id: { S: RELEASE_ID } } } : {});
  tables.on(GetItemCommand, { Key: { id: { S: RELEASE_ID } } }).resolves(item ? { Item: item } : {});
};

const lambdaAnswers = (payload: unknown, functionError?: string) =>
  functions.on(InvokeCommand).resolves({
    StatusCode: 200,
    FunctionError: functionError,
    Payload: new TextEncoder().encode(JSON.stringify(payload)) as never,
  });

describe('production releases', () => {
  let context: TestContext;
  let approver: string;
  let viewer: string;
  let otherProject: string;
  const http = () => request(context.app.getHttpServer());
  const decide = (decision: string, cookie = approver, extra: object = {}) =>
    http().post('/api/production-releases/decide').set('Cookie', cookie).send({ decision, ...extra });
  const audit = () =>
    context.owner
      .selectFrom('audit_events')
      .select(['action', 'actor_email', 'target_id', 'metadata'])
      .where('action', 'like', 'production.release.%')
      .orderBy('occurred_at')
      .execute();

  beforeAll(async () => {
    Object.assign(process.env, {
      PRODUCTION_RELEASES_ROLE_ARN: 'arn:aws:iam::860922939595:role/PulseGridProductionReleases',
      PRODUCTION_RELEASES_PROJECT: 'acme',
    });
    context = await startTestApp((builder) =>
      builder.overrideProvider(PRODUCTION_CLIENTS).useValue({ dynamodb, lambda }),
    );
    approver = await signIn(context, context.acme, user('ada', 'developer'));
    viewer = await signIn(context, context.acme, user('vic', 'viewer'));
    otherProject = await signIn(context, context.globex, user('gia', 'developer'));
    await setExtraPermissions(context, context.acme, 'developer', ['production.release.decide']);
    await setExtraPermissions(context, context.globex, 'developer', ['production.release.decide']);
  });
  afterAll(() => context.close());
  afterEach(async () => {
    tables.reset();
    functions.reset();
    await context.owner.deleteFrom('audit_events').where('action', 'like', 'production.release.%').execute();
  });

  it('shows the release waiting for a decision', async () => {
    releaseInProgress(release());
    const { body } = await http().get('/api/production-releases/current').set('Cookie', approver).expect(200);
    expect(body).toEqual({
      ready: true,
      current: {
        id: RELEASE_ID,
        status: 'HOLD',
        components: [
          { name: 'backend', tag: 'main-1a2b3c4' },
          { name: 'frontend-next', tag: 'main-9f8e7d6' },
        ],
        requestedBy: 'ada@example.test',
        createdAt: '2026-11-18T09:30:00.000Z',
        holdStartedAt: '2026-11-18T09:40:00.000Z',
        holdUntil: '2026-11-18T17:40:00.000Z',
        decision: null,
        decidedBy: null,
        snapshot: null,
      },
    });
    expect((await http().get('/api/production-releases/waiting').set('Cookie', approver).expect(200)).body).toEqual({
      count: 1,
    });
  });

  it('says when no release is in progress', async () => {
    releaseInProgress(null);
    expect((await http().get('/api/production-releases/current').set('Cookie', approver).expect(200)).body).toEqual({
      ready: true,
      current: null,
    });
    expect((await http().get('/api/production-releases/waiting').set('Cookie', approver).expect(200)).body).toEqual({
      count: 0,
    });
  });

  it('lists the 20 newest releases, skipping the ACTIVE marker', async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: { S: `rel-${String(index).padStart(2, '0')}` },
      status: { S: 'SUCCEEDED' },
      created_at: { S: String(1794994200 + index * 3600) },
      decision: { S: 'FINISH' },
    }));
    tables
      .on(ScanCommand)
      .resolvesOnce({ Items: [{ id: { S: 'ACTIVE' }, release_id: { S: 'rel-24' } }, ...items.slice(0, 10)], LastEvaluatedKey: { id: { S: 'rel-09' } } })
      .resolves({ Items: items.slice(10) });
    const { body } = await http().get('/api/production-releases/history').set('Cookie', approver).expect(200);
    expect(body).toHaveLength(20);
    expect(body[0]).toMatchObject({ id: 'rel-24', status: 'SUCCEEDED', decision: 'FINISH' });
    expect(body.at(-1).id).toBe('rel-05');
  });

  it('finishes the release as the signed-in person, whatever the body says, and audits it', async () => {
    releaseInProgress(release());
    lambdaAnswers({ release_id: RELEASE_ID, decision: 'FINISH', by: 'ada@example.test' });

    const { body } = await decide('finish', approver, { by: 'someone-else@example.test' }).expect(201);
    expect(body).toEqual({ releaseId: RELEASE_ID, decision: 'FINISH', decidedBy: 'ada@example.test' });

    const [call] = functions.commandCalls(InvokeCommand);
    expect(call?.args[0].input).toMatchObject({
      FunctionName: 'dreamzino-production-release-decide',
      InvocationType: 'RequestResponse',
    });
    expect(JSON.parse(new TextDecoder().decode(call?.args[0].input.Payload as Uint8Array))).toEqual({
      decision: 'finish',
      by: 'ada@example.test',
    });
    expect(await audit()).toEqual([
      {
        action: 'production.release.finished',
        actor_email: 'ada@example.test',
        target_id: RELEASE_ID,
        metadata: { decision: 'FINISH', result: 'succeeded' },
      },
    ]);
  });

  it('rolls the release back', async () => {
    releaseInProgress(release());
    lambdaAnswers({ release_id: RELEASE_ID, decision: 'ROLLBACK', by: 'ada@example.test' });
    expect((await decide('rollback').expect(201)).body).toMatchObject({ decision: 'ROLLBACK' });
    expect((await audit())[0]).toMatchObject({ action: 'production.release.rolled_back' });
  });

  it.each([
    ['no release', null, 'There is no production release in progress.'],
    ['a release past its hold', release({ status: 'FINISH' }), 'This release is no longer waiting for a decision.'],
    [
      'a release already decided',
      release({ decision: 'ROLLBACK', decided_by: 'bo@example.test' }),
      'This release was already decided by bo@example.test.',
    ],
  ])('refuses %s in plain words without calling the function', async (_, item, message) => {
    releaseInProgress(item);
    expect((await decide('finish').expect(409)).body).toEqual({ message });
    expect(functions.commandCalls(InvokeCommand)).toHaveLength(0);
    expect((await audit())[0]).toMatchObject({
      action: 'production.release.decision_failed',
      metadata: { decision: 'FINISH', result: message },
    });
  });

  it("turns the function's refusal into a plain sentence", async () => {
    releaseInProgress(release());
    lambdaAnswers({ errorType: 'Exception', errorMessage: 'Release rel-20261118-0930 is not in HOLD (status SWITCH)' }, 'Unhandled');
    expect((await decide('rollback').expect(409)).body).toEqual({
      message: 'This release is no longer waiting for a decision.',
    });
  });

  it('never shows raw AWS errors', async () => {
    releaseInProgress(release());
    functions.on(InvokeCommand).rejects(Object.assign(new Error('User: arn:aws:sts::121017505984 is not authorized'), { name: 'AccessDeniedException' }));
    const { body } = await decide('finish').expect(503);
    expect(body.message).toBe(
      "PulseGrid couldn't record the decision. Try again, or use the Release production workflow in GitHub.",
    );

    tables.reset();
    tables.on(GetItemCommand).rejects(Object.assign(new Error('ResourceNotFoundException: table'), { name: 'ResourceNotFoundException' }));
    expect((await http().get('/api/production-releases/current').set('Cookie', approver).expect(503)).body).toEqual({
      message: "PulseGrid couldn't read the production release right now. Try again in a minute.",
    });
  });

  it('is only for people allowed to decide, in the project that shows it', async () => {
    await http().get('/api/production-releases/current').set('Cookie', viewer).expect(403);
    await decide('finish', viewer).expect(403);
    expect((await http().get('/api/production-releases/current').set('Cookie', otherProject).expect(200)).body).toEqual({
      ready: false,
    });
    await decide('finish', otherProject).expect(404);
    await decide('ship-it').expect(400);
    expect(functions.commandCalls(InvokeCommand)).toHaveLength(0);
  });
});
