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

const source = {
  listTemplates: vi.fn<ExperimentSource['listTemplates']>(),
  listExperiments: vi.fn<ExperimentSource['listExperiments']>(),
  getExperiment: vi.fn<ExperimentSource['getExperiment']>(),
  start: vi.fn<ExperimentSource['start']>(),
  stop: vi.fn<ExperimentSource['stop']>(),
  failureMessage: () => 'AWS refused this experiment.',
};
const provider: CloudProvider = { ...awsProvider, actions: [], experimentSource: source };

describe('fault experiments', () => {
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
      blockedReason: 'Ask your super admin for the Run staging fault experiments permission.',
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

  it('keeps production read-only, for starting and stopping', async () => {
    const { id } = await addAccount('Production');
    const refused = await start(id);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toBe('Production is read-only.');
    await http().post(`/api/cloud/accounts/${id}/experiments/${REGION}/EXP1/stop`).set('Cookie', developer).expect(403);
    expect(source.start).not.toHaveBeenCalled();
    expect(source.stop).not.toHaveBeenCalled();
    expect((await actions('EXT1')).map(({ action }) => action)).toContain('access.denied');
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
});
