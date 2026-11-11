import type { ExperimentState, ExperimentSummary } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { newEnvironment } from '../src/inventory/environments/account-environment';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import { CLOUD_PROVIDER_LIST, type CloudProvider, type ExperimentSource } from '../src/inventory/providers/provider';
import { setExtraPermissions, signIn, startTestApp, type TestContext, user } from './support/test-app';

const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'never-shown' };
const REGION = 'eu-central-1';
const TEMPLATE = {
  id: 'EXT1',
  region: REGION,
  label: 'Database failover',
  description: 'Fail over the staging database',
  targets: [],
  steps: [],
  stopAlarms: ['staging-errors'],
};

const SECOND = { ...TEMPLATE, id: 'EXT2', label: 'Cache reboot', description: null, stopAlarms: [] };
const summary = (id: string, templateId: string, state: ExperimentState): ExperimentSummary => ({
  id,
  region: REGION,
  templateId,
  label: templateId,
  state,
  reason: null,
  startedAt: '2026-11-10T12:00:00.000Z',
  endedAt: null,
});

const source = {
  listTemplates: vi.fn<ExperimentSource['listTemplates']>(),
  listExperiments: vi.fn<ExperimentSource['listExperiments']>(),
  getExperiment: vi.fn<ExperimentSource['getExperiment']>(),
  start: vi.fn<ExperimentSource['start']>(),
  stop: vi.fn<ExperimentSource['stop']>(),
  failureMessage: () => 'AWS refused this experiment.',
};
const provider: CloudProvider = { ...awsProvider, actions: [], experimentSource: source };

describe('failover tests', () => {
  let context: TestContext;
  let developer: string;
  let viewer: string;
  let otherOwner: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());

  const addAccount = async (environment: string, sealed = true) => {
    const tenantId = context.acme.tenant.id;
    sequence += 1;
    const row = { tenant_id: tenantId, provider: 'aws', account_id: String(600000000000 + sequence) };
    const { id: environmentId } = await context.owner
      .insertInto('environments')
      .values(newEnvironment(tenantId, environment, sequence))
      .onConflict((conflict) => conflict.columns(['tenant_id', 'name']).doUpdateSet({ sort_order: sequence }))
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        ...row,
        name: `${environment} account`,
        regions: [REGION],
        encrypted_credentials: sealed ? context.app.get(CredentialVault).seal(row, KEY) : null,
        environment_id: environmentId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.owner
      .insertInto('resources')
      .values({
        tenant_id: tenantId,
        cloud_account_id: id,
        region: REGION,
        type: 'rds-instance',
        service: 'rds',
        native_id: `arn:aws:rds:${REGION}:${row.account_id}:db:staging-db`,
        name: 'staging-db',
        status: 'available',
        health: 'healthy',
        tags: '{}',
        details: '{}',
        last_seen_at: new Date(),
      })
      .execute();
    return { id, awsAccount: row.account_id };
  };

  const start = (accountId: string, cookie = developer) =>
    http().post(`/api/cloud/accounts/${accountId}/experiments`).set('Cookie', cookie).send({ region: REGION, templateId: 'EXT1' });
  const actions = (targetId: string) =>
    context.owner.selectFrom('audit_events').select(['action', 'actor_email']).where('target_id', '=', targetId).execute();

  beforeAll(async () => {
    context = await startTestApp((builder) => builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]));
    developer = await signIn(context, context.acme, user('dev', 'developer'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    otherOwner = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    vi.clearAllMocks();
    source.listTemplates.mockResolvedValue([TEMPLATE]);
    source.listExperiments.mockResolvedValue([
      { id: 'EXP1', region: REGION, templateId: 'EXT1', label: 'EXT1', state: 'completed', reason: null, startedAt: '2026-11-10T10:00:00.000Z', endedAt: null },
    ]);
    source.start.mockResolvedValue('EXP2');
    source.stop.mockResolvedValue();
    await setExtraPermissions(context, context.acme, 'developer', ['experiment.run']);
  });

  it('lists templates and experiments for everyone, with template names on experiments', async () => {
    const { id } = await addAccount('Staging');
    const { body } = await http().get(`/api/cloud/accounts/${id}/experiments`).set('Cookie', viewer).expect(200);
    expect(body.templates).toEqual([TEMPLATE]);
    expect(body.experiments[0]).toMatchObject({ id: 'EXP1', label: 'Database failover' });
    expect(body.access).toEqual({
      canRun: false,
      blockedReason: 'Ask your super admin for the Run staging failover tests permission.',
    });
  });

  it('starts an experiment outside production and records who did it', async () => {
    const { id, awsAccount } = await addAccount('Staging');
    const { body } = await start(id).expect(201);
    expect(body).toEqual({ id: 'EXP2', region: REGION });
    expect(source.start).toHaveBeenCalledWith({ credentials: KEY, region: REGION }, 'EXT1', expect.any(String));
    const [event] = await context.owner
      .selectFrom('audit_events')
      .select(['action', 'actor_email', 'metadata'])
      .where('target_id', '=', 'EXP2')
      .execute();
    expect(event).toMatchObject({ action: 'cloud.experiment.started', actor_email: 'dev@example.test' });
    expect(event?.metadata).toMatchObject({ template: 'EXT1', region: REGION, cloudAccount: awsAccount });
  });

  it('needs the production permission to start or stop in production', async () => {
    const { id } = await addAccount('Production');
    const refused = await start(id);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('Ask your super admin for the Run production failover tests permission.');
    await http().post(`/api/cloud/accounts/${id}/experiments/${REGION}/EXP1/stop`).set('Cookie', developer).expect(403);
    expect(source.start).not.toHaveBeenCalled();
    expect(source.stop).not.toHaveBeenCalled();
    expect((await actions('EXT1')).map(({ action }) => action)).toContain('access.denied');

    await setExtraPermissions(context, context.acme, 'developer', ['production.experiment.run']);
    await start(id).expect(201);
    await http().post(`/api/cloud/accounts/${id}/experiments/${REGION}/EXP1/stop`).set('Cookie', developer).expect(204);
    const staging = await addAccount('Staging');
    expect((await start(staging.id)).body.message).toBe(
      'Ask your super admin for the Run staging failover tests permission.',
    );
  });

  it('needs the permission and an access key', async () => {
    await start((await addAccount('Staging')).id, viewer).expect(403);
    const keyless = await start((await addAccount('Staging', false)).id);
    expect(keyless.body.message).toBe('This account has no access key. Add one under Integrations.');
    expect(source.start).not.toHaveBeenCalled();
  });

  it('stops an experiment and records it', async () => {
    const { id } = await addAccount('Staging');
    await http().post(`/api/cloud/accounts/${id}/experiments/${REGION}/EXP5/stop`).set('Cookie', developer).expect(204);
    expect(source.stop).toHaveBeenCalledWith({ credentials: KEY, region: REGION }, 'EXP5');
    expect(await actions('EXP5')).toEqual([{ action: 'cloud.experiment.stopped', actor_email: 'dev@example.test' }]);
  });

  it('shows an experiment with who started it and the resources it touched', async () => {
    const { id, awsAccount } = await addAccount('Staging');
    await start(id).expect(201);
    source.getExperiment.mockResolvedValue({
      id: 'EXP2',
      region: REGION,
      templateId: 'EXT1',
      label: 'Database failover',
      description: null,
      state: 'running',
      reason: null,
      startedAt: '2026-11-10T12:00:00.000Z',
      endedAt: null,
      steps: [],
      targets: [],
      stopAlarms: [],
      resolvedResourceIds: [`arn:aws:rds:${REGION}:${awsAccount}:db:staging-db`],
    });
    const { body } = await http().get(`/api/cloud/accounts/${id}/experiments/${REGION}/EXP2`).set('Cookie', viewer).expect(200);
    expect(body).toMatchObject({ state: 'running', startedBy: 'dev@example.test' });
    expect(body.resources).toEqual([
      { id: expect.any(String), name: 'staging-db', type: 'rds-instance', path: expect.stringMatching(/^\/infrastructure\/rds\//) },
    ]);
  });

  it('turns AWS failures into readable messages and refuses bad input and other projects', async () => {
    const { id } = await addAccount('Staging');
    source.start.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'ValidationException' }));
    const failed = await start(id);
    expect(failed.status).toBe(409);
    expect(failed.body.message).toBe('AWS refused this experiment.');
    await http().get(`/api/cloud/accounts/${id}/experiments/not-a-region/EXP1`).set('Cookie', viewer).expect(400);
    await http().get(`/api/cloud/accounts/${id}/experiments/us-east-1/EXP1`).set('Cookie', viewer).expect(404);
    await http().get(`/api/cloud/accounts/${id}/experiments`).set('Cookie', otherOwner).expect(404);
    source.getExperiment.mockResolvedValue(null);
    await http().get(`/api/cloud/accounts/${id}/experiments/${REGION}/EXP9`).set('Cookie', viewer).expect(404);
  });
  describe('groups and runs', () => {
    const groups = (accountId: string) => `/api/cloud/accounts/${accountId}/experiment-groups`;
    const runs = (accountId: string) => `/api/cloud/accounts/${accountId}/experiment-runs`;
    const first = { region: REGION, templateId: 'EXT1' };
    const both = [first, { region: REGION, templateId: 'EXT2' }];
    const createGroup = (accountId: string, templates = both, cookie = developer) =>
      http().post(groups(accountId)).set('Cookie', cookie).send({ name: 'Data layer', templates });

    beforeEach(() => {
      source.listTemplates.mockResolvedValue([TEMPLATE, SECOND]);
      source.start.mockImplementation(async (_context, templateId) => `RUN${templateId}`);
    });

    it('creates, edits and deletes groups, and lists them on the view', async () => {
      const { id } = await addAccount('Staging');
      const { body: group } = await createGroup(id).expect(201);
      expect(group).toEqual({ id: expect.any(String), name: 'Data layer', templates: both });
      expect((await createGroup(id)).body.message).toBe('A group with that name already exists.');
      await http()
        .put(`${groups(id)}/${group.id}`)
        .set('Cookie', developer)
        .send({ name: 'Database only', templates: [first] })
        .expect(200);
      const { body: view } = await http().get(`/api/cloud/accounts/${id}/experiments`).set('Cookie', viewer).expect(200);
      expect(view.groups).toEqual([{ id: group.id, name: 'Database only', templates: [first] }]);
      await http().delete(`${groups(id)}/${group.id}`).set('Cookie', developer).expect(204);
      await http().delete(`${groups(id)}/${group.id}`).set('Cookie', developer).expect(404);
      expect((await actions(group.id)).map(({ action }) => action)).toEqual([
        'cloud.experiment-group.created',
        'cloud.experiment-group.updated',
        'cloud.experiment-group.deleted',
      ]);
    });

    it('refuses bad groups, people without the permission and production', async () => {
      const { id } = await addAccount('Staging');
      await createGroup(id, []).expect(400);
      await createGroup(id, [first, first]).expect(400);
      expect((await createGroup(id, [{ region: 'us-east-1', templateId: 'EXT1' }])).status).toBe(400);
      await createGroup(id, both, viewer).expect(403);
      const production = await addAccount('Production');
      expect((await createGroup(production.id)).body.message).toBe(
        'Ask your super admin for the Run production failover tests permission.',
      );
    });

    it('runs a group with one click and reports templates that did not start', async () => {
      const { id } = await addAccount('Staging');
      const templates = [...both, { region: REGION, templateId: 'GONE' }];
      const { body: group } = await createGroup(id, templates).expect(201);
      source.start.mockImplementation(async (_context, templateId) => {
        if (templateId === 'EXT2') {
          throw Object.assign(new Error('raw'), { name: 'ServiceQuotaExceededException' });
        }
        return 'RUNEXT1';
      });
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({ groupId: group.id }).expect(201);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'running')]);
      const { body: detail } = await http().get(`${runs(id)}/${run.id}`).set('Cookie', viewer).expect(200);
      expect(detail).toMatchObject({ label: 'Data layer', startedBy: 'dev@example.test', error: null });
      expect(detail.items).toEqual([
        { region: REGION, templateId: 'EXT1', label: 'Database failover', experimentId: 'RUNEXT1', error: null, state: 'running' },
        { region: REGION, templateId: 'EXT2', label: 'Cache reboot', experimentId: null, error: 'AWS refused this experiment.', state: null },
        { region: REGION, templateId: 'GONE', label: 'GONE', experimentId: null, error: 'This template no longer exists in AWS.', state: null },
      ]);
      expect(await actions('RUNEXT1')).toEqual([{ action: 'cloud.experiment.started', actor_email: 'dev@example.test' }]);
      const [event] = await context.owner.selectFrom('audit_events').select(['action', 'metadata']).where('target_id', '=', run.id).execute();
      expect(event).toMatchObject({ action: 'cloud.experiment-run.started', metadata: { label: 'Data layer', started: 1, failed: 2 } });
      const { body: view } = await http().get(`/api/cloud/accounts/${id}/experiments`).set('Cookie', viewer).expect(200);
      expect(view.runs).toEqual([
        { id: run.id, label: 'Data layer', startedAt: expect.any(String), startedBy: 'dev@example.test', started: 1, failed: 2 },
      ]);
    });

    it('runs every template with one click, and refuses when there is nothing to run', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({}).expect(201);
      expect(source.start).toHaveBeenCalledTimes(2);
      source.listExperiments.mockResolvedValue([]);
      source.getExperiment.mockResolvedValue(null);
      const { body: detail } = await http().get(`${runs(id)}/${run.id}`).set('Cookie', viewer).expect(200);
      expect(detail.label).toBe('All tests');
      expect(detail.items.map(({ experimentId }: { experimentId: string }) => experimentId)).toEqual(['RUNEXT1', 'RUNEXT2']);
      source.listTemplates.mockResolvedValue([]);
      const empty = await http().post(runs(id)).set('Cookie', developer).send({});
      expect(empty.status).toBe(409);
      expect(empty.body.message).toBe('There are no failover test templates to run.');
    });

    it('stops every experiment of a run that is still active', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({}).expect(201);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'running'), summary('RUNEXT2', 'EXT2', 'completed')]);
      await http().post(`${runs(id)}/${run.id}/stop`).set('Cookie', developer).expect(204);
      expect(source.stop).toHaveBeenCalledTimes(1);
      expect(source.stop).toHaveBeenCalledWith({ credentials: KEY, region: REGION }, 'RUNEXT1');
      expect((await actions(run.id)).map(({ action }) => action)).toEqual([
        'cloud.experiment-run.started',
        'cloud.experiment-run.stopped',
      ]);
    });

    it('needs the production permission in production, and keeps other projects out', async () => {
      const { id } = await addAccount('Production');
      const refused = await http().post(runs(id)).set('Cookie', developer).send({});
      expect(refused.status).toBe(403);
      expect(source.start).not.toHaveBeenCalled();
      await setExtraPermissions(context, context.acme, 'developer', ['experiment.run', 'production.experiment.run']);
      await createGroup(id).expect(201);
      await http().post(runs(id)).set('Cookie', developer).send({}).expect(201);
      const staging = await addAccount('Staging');
      const { body: run } = await http().post(runs(staging.id)).set('Cookie', developer).send({}).expect(201);
      await http().get(`${runs(staging.id)}/${run.id}`).set('Cookie', otherOwner).expect(404);
      await http().post(runs(staging.id)).set('Cookie', viewer).send({}).expect(403);
      await http().post(runs(staging.id)).set('Cookie', developer).send({ groupId: 'nope' }).expect(400);
    });
  });
});
