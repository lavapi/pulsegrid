import type { ExperimentState, ExperimentSummary } from '@pulsegrid/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { ExperimentReportCapture } from '../src/inventory/experiments/experiment-report-capture';
import { NOTES, RunSequencer } from '../src/inventory/experiments/run-sequencer';
import { newEnvironment } from '../src/inventory/environments/account-environment';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import {
  CLOUD_PROVIDER_LIST,
  type CloudProvider,
  type ExperimentRecord,
  type ExperimentSource,
} from '../src/inventory/providers/provider';
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
const THIRD = { ...TEMPLATE, id: 'EXT3', label: 'Zone outage', description: null, stopAlarms: [] };
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

const record = (id: string, templateId: string, state: ExperimentState, label = 'Database failover'): ExperimentRecord => ({
  ...summary(id, templateId, state),
  label,
  description: null,
  reason: state === 'stopped' ? 'Experiment stopped by stop condition.' : null,
  endedAt: '2026-11-10T12:10:00.000Z',
  steps: [{ name: 'Reboot', actionId: 'aws:rds:reboot-db-instances', description: null, duration: null, state, reason: null, startedAt: null, endedAt: null }],
  targets: [],
  stopAlarms: ['staging-errors'],
  resolvedResourceIds: [],
});

const source = {
  listTemplates: vi.fn<ExperimentSource['listTemplates']>(),
  listExperiments: vi.fn<ExperimentSource['listExperiments']>(),
  getExperiment: vi.fn<ExperimentSource['getExperiment']>(),
  start: vi.fn<ExperimentSource['start']>(),
  stop: vi.fn<ExperimentSource['stop']>(),
  isQuotaFull: (error: unknown) => (error as Error).name === 'ServiceQuotaExceededException',
  footprint: vi.fn<ExperimentSource['footprint']>(),
  environmentHealth: vi.fn<ExperimentSource['environmentHealth']>(),
  notReady: vi.fn<ExperimentSource['notReady']>(),
  restartStopped: vi.fn<ExperimentSource['restartStopped']>(),
  resolvedTargets: vi.fn<ExperimentSource['resolvedTargets']>(),
  failureMessage: () => 'AWS refused this experiment.',
};
const FOOTPRINT = { resources: [], zoneWide: false, stopsInstances: false, needsSpareTask: false };
const provider: CloudProvider = { ...awsProvider, actions: [], experimentSource: source };

describe('failover tests', () => {
  let context: TestContext;
  let developer: string;
  let viewer: string;
  let otherOwner: string;
  let admin: string;
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
    admin = await signIn(context, context.acme, user('ada', 'admin'));
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
    source.footprint.mockReturnValue(FOOTPRINT);
    source.environmentHealth.mockResolvedValue([]);
    source.notReady.mockResolvedValue(null);
    source.restartStopped.mockResolvedValue({ started: [], waiting: [] });
    source.resolvedTargets.mockResolvedValue([]);
    await context.owner.deleteFrom('experiment_reports').execute();
    await context.owner.deleteFrom('experiment_runs').execute();
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
      { id: expect.any(String), name: 'staging-db', displayName: null, type: 'rds-instance', path: expect.stringMatching(/^\/infrastructure\/rds\//) },
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
    const detail = async (accountId: string, runId: string) =>
      (await http().get(`${runs(accountId)}/${runId}`).set('Cookie', viewer).expect(200)).body;
    const advance = (runId: string) => context.app.get(RunSequencer).advance(context.acme.tenant.id, runId);

    beforeEach(() => {
      source.listTemplates.mockResolvedValue([TEMPLATE, SECOND]);
      source.start.mockImplementation(async (_context, templateId) => `RUN${templateId}`);
    });

    it('creates, edits and deletes groups, and lists them on the view', async () => {
      const { id } = await addAccount('Staging');
      const { body: group } = await createGroup(id).expect(201);
      expect(group).toEqual({ id: expect.any(String), name: 'Data layer', templates: both, waveSize: null });
      expect((await createGroup(id)).body.message).toBe('A group with that name already exists.');
      await http()
        .put(`${groups(id)}/${group.id}`)
        .set('Cookie', developer)
        .send({ name: 'Database only', templates: [first] })
        .expect(200);
      const { body: view } = await http().get(`/api/cloud/accounts/${id}/experiments`).set('Cookie', viewer).expect(200);
      expect(view.groups).toEqual([{ id: group.id, name: 'Database only', templates: [first], waveSize: null }]);
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

    it('runs a group one test at a time, and reports templates that did not start', async () => {
      const { id } = await addAccount('Staging');
      const { body: group } = await createGroup(id, [...both, { region: REGION, templateId: 'GONE' }]).expect(201);
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({ groupId: group.id }).expect(201);
      expect(source.start).toHaveBeenCalledTimes(1);
      expect((await detail(id, run.id)).items).toMatchObject([
        { templateId: 'EXT1', experimentId: 'RUNEXT1', settling: true, waiting: false, startedAt: expect.any(String) },
        { templateId: 'EXT2', experimentId: null, waiting: true, note: NOTES.previous },
        { templateId: 'GONE', experimentId: null, error: 'This template no longer exists in AWS.' },
      ]);

      source.getExperiment.mockResolvedValue(record('RUNEXT1', 'EXT1', 'running'));
      await advance(run.id);
      expect(source.start).toHaveBeenCalledTimes(1);

      source.getExperiment.mockResolvedValue(record('RUNEXT1', 'EXT1', 'completed'));
      source.start.mockRejectedValue(Object.assign(new Error('raw'), { name: 'ValidationException' }));
      await advance(run.id);
      const body = await detail(id, run.id);
      expect(body.items[0]).toMatchObject({ settling: false, endedAt: '2026-11-10T12:10:00.000Z', healthyAt: expect.any(String) });
      expect(body.items[1]).toMatchObject({ waiting: false, error: 'AWS refused this experiment.' });
      expect(body).toMatchObject({ label: 'Data layer', startedBy: 'dev@example.test', stoppedReason: null, result: 'failed' });
      expect(await actions('RUNEXT1')).toEqual([{ action: 'cloud.experiment.started', actor_email: 'dev@example.test' }]);
      const [event] = await context.owner.selectFrom('audit_events').select(['action', 'metadata']).where('target_id', '=', run.id).execute();
      expect(event).toMatchObject({ action: 'cloud.experiment-run.started', metadata: { label: 'Data layer', tests: 3, production: false } });
    });

    it('runs every template, and refuses when there is nothing to run', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({}).expect(201);
      expect(source.start).toHaveBeenCalledTimes(1);
      expect((await detail(id, run.id)).label).toBe('All tests');
      source.listTemplates.mockResolvedValue([]);
      const empty = await http().post(runs(id)).set('Cookie', developer).send({});
      expect(empty.status).toBe(409);
      expect(empty.body.message).toBe('There are no failover test templates to run.');
    });

    it('stops the running test and cancels the rest on Stop all', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({}).expect(201);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'running')]);
      await http().post(`${runs(id)}/${run.id}/stop`).set('Cookie', developer).expect(204);
      expect(source.stop).toHaveBeenCalledWith({ credentials: KEY, region: REGION }, 'RUNEXT1');
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'stopped')]);
      source.getExperiment.mockResolvedValue(record('RUNEXT1', 'EXT1', 'stopped'));
      await advance(run.id);
      expect(source.start).toHaveBeenCalledTimes(1);
      const body = await detail(id, run.id);
      expect(body.items.map(({ cancelled }: { cancelled?: boolean }) => Boolean(cancelled))).toEqual([false, true]);
      expect(body.result).toBe('stopped');
      expect((await actions(run.id)).map(({ action }) => action)).toEqual(['cloud.experiment-run.started', 'cloud.experiment-run.stopped']);
    });

    it('needs the production permission and an explicit confirmation in production, and keeps other projects out', async () => {
      const { id } = await addAccount('Production');
      expect((await http().post(runs(id)).set('Cookie', developer).send({ confirmProduction: true })).status).toBe(403);
      await setExtraPermissions(context, context.acme, 'developer', ['experiment.run', 'production.experiment.run']);
      const unconfirmed = await http().post(runs(id)).set('Cookie', developer).send({});
      expect(unconfirmed.status).toBe(400);
      expect(unconfirmed.body.message).toBe('Confirm that these tests run in production before starting them.');
      expect(source.start).not.toHaveBeenCalled();
      await http().post(runs(id)).set('Cookie', developer).send({ confirmProduction: true }).expect(201);
      const staging = await addAccount('Staging');
      const { body: run } = await http().post(runs(staging.id)).set('Cookie', developer).send({}).expect(201);
      await http().get(`${runs(staging.id)}/${run.id}`).set('Cookie', otherOwner).expect(404);
      await http().post(runs(staging.id)).set('Cookie', viewer).send({}).expect(403);
      await http().post(runs(staging.id)).set('Cookie', developer).send({ groupId: 'nope' }).expect(400);
    });
  });
  describe('reports', () => {
    const runs = (accountId: string) => `/api/cloud/accounts/${accountId}/experiment-runs`;
    const history = (accountId: string, query = '', cookie = viewer) =>
      http().get(`/api/experiment-reports?account=${accountId}${query}`).set('Cookie', cookie);
    const capture = (accountId: string) =>
      context.app.get(ExperimentReportCapture).captureAccount({ tenantId: context.acme.tenant.id, accountId });
    const advance = (runId: string) => context.app.get(RunSequencer).advance(context.acme.tenant.id, runId);
    const reportCount = async (accountId: string) =>
      (await context.owner.selectFrom('experiment_reports').select('id').where('cloud_account_id', '=', accountId).execute()).length;

    beforeEach(() => {
      source.listTemplates.mockResolvedValue([TEMPLATE, SECOND]);
      source.start.mockImplementation(async (_context, templateId) => `RUN${templateId}`);
      source.getExperiment.mockImplementation(async (_context, id) =>
        id === 'RUNEXT2' ? record(id, 'EXT2', 'stopped', 'Cache reboot') : record(id, 'EXT1', 'completed'),
      );
    });

    it('saves a report once for every test that ended, including ones started outside PulseGrid', async () => {
      const { id } = await addAccount('Staging');
      source.listExperiments.mockResolvedValue([summary('OUT1', 'EXT1', 'completed'), summary('LIVE', 'EXT1', 'running')]);
      await capture(id);
      await capture(id);
      expect(source.getExperiment).toHaveBeenCalledTimes(1);
      expect(await reportCount(id)).toBe(1);
      const saved = await context.owner
        .selectFrom('experiment_reports')
        .select('id')
        .where('experiment_id', '=', 'OUT1')
        .executeTakeFirstOrThrow();
      const { body } = await history(id);
      const entry = body.entries.find(({ id: entryId }: { id: string }) => entryId === saved.id);
      expect(entry).toMatchObject({ kind: 'test', label: 'Database failover', result: 'passed', startedBy: null });
      const { body: report } = await http().get(`/api/experiment-reports/${saved.id}`).set('Cookie', viewer).expect(200);
      expect(report).toMatchObject({ experimentId: 'OUT1', environmentName: 'Staging', stopAlarms: ['staging-errors'], run: null });
      expect(report.accountName).toBe('Staging account');
    });

    it('reports a group run in one place once its tests end', async () => {
      const { id } = await addAccount('Staging');
      const { body: started } = await http().post(runs(id)).set('Cookie', developer).send({}).expect(201);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'running'), summary('RUNEXT2', 'EXT2', 'running')]);
      const { body: live } = await http().get(`${runs(id)}/${started.id}`).set('Cookie', viewer).expect(200);
      expect(live).toMatchObject({ result: 'running', endedAt: null, environmentName: 'Staging' });

      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'completed'), summary('RUNEXT2', 'EXT2', 'stopped')]);
      await advance(started.id);
      await advance(started.id);
      const { body: done } = await http().get(`${runs(id)}/${started.id}`).set('Cookie', viewer).expect(200);
      expect(done).toMatchObject({ result: 'stopped', endedAt: '2026-11-10T12:10:00.000Z' });
      expect(done.items.map(({ report }: { report: { result: string } }) => report.result)).toEqual(['passed', 'stopped']);
      expect(done.items[1].report).toMatchObject({ reason: 'Experiment stopped by stop condition.' });
      expect(await reportCount(id)).toBe(2);

      const { body } = await history(id, '&label=All%20tests');
      expect(body.entries[0]).toMatchObject({
        kind: 'run',
        id: started.id,
        result: 'stopped',
        counts: { total: 2, passed: 1, stopped: 1, failed: 0, notStarted: 0, skipped: 0, repairs: 0 },
      });
      expect(body.entries.filter(({ kind }: { kind: string }) => kind === 'test')).toEqual([]);
      expect(body.labels).toContain('All tests');
      const reportId = done.items[0].report.id;
      const { body: report } = await http().get(`/api/experiment-reports/${reportId}`).set('Cookie', viewer).expect(200);
      expect(report.run).toEqual({ id: started.id, label: 'All tests' });
    });

    it('shows only the selected account, so staging and production history stay apart', async () => {
      const staging = await addAccount('Staging');
      const production = await addAccount('Production');
      source.listExperiments.mockResolvedValue([summary('STG1', 'EXT1', 'completed')]);
      await capture(staging.id);
      source.listExperiments.mockResolvedValue([summary('PRD1', 'EXT1', 'completed')]);
      await capture(production.id);
      const ids = async (accountId: string) => {
        const rows = await context.owner.selectFrom('experiment_reports').select('id').where('cloud_account_id', '=', accountId).execute();
        return rows.map(({ id }) => id);
      };
      const entriesOf = async (accountId: string) =>
        (await history(accountId).expect(200)).body.entries.map(({ id }: { id: string }) => id);
      expect(await entriesOf(staging.id)).toEqual(await ids(staging.id));
      expect(await entriesOf(production.id)).toEqual(await ids(production.id));
      const exported = await http().get(`/api/experiment-reports/export?account=${staging.id}`).set('Cookie', viewer);
      expect(exported.text.split('\n')).toHaveLength(2);
      expect(exported.text).toContain('Staging');
      expect(exported.text).not.toContain('Production');
    });

    it('exports the history as CSV and refuses bad filters', async () => {
      const { id } = await addAccount('Staging');
      source.listExperiments.mockResolvedValue([summary('CSV1', 'EXT1', 'completed')]);
      await capture(id);
      const response = await http()
        .get(`/api/experiment-reports/export?account=${id}&result=passed`)
        .set('Cookie', viewer)
        .expect(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.text.split('\n')[0]).toContain('Type,Name,Account');
      expect(response.text).toContain('Test,Database failover');
      await history(id, '&result=great').expect(400);
      await history(id, '&from=yesterday').expect(400);
      await http().get('/api/experiment-reports').set('Cookie', viewer).expect(400);
    });

    it('lets only people who manage environments delete reports and runs', async () => {
      const { id } = await addAccount('Staging');
      const { body: started } = await http().post(runs(id)).set('Cookie', developer).send({}).expect(201);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'completed'), summary('RUNEXT2', 'EXT2', 'completed')]);
      await http().get(`${runs(id)}/${started.id}`).set('Cookie', viewer).expect(200);
      await http().delete(`/api/experiment-reports/runs/${started.id}`).set('Cookie', developer).expect(403);
      await http().delete(`/api/experiment-reports/runs/${started.id}`).set('Cookie', admin).expect(204);
      expect(await reportCount(id)).toBe(0);
      await http().get(`${runs(id)}/${started.id}`).set('Cookie', viewer).expect(404);
      expect((await actions(started.id)).map(({ action }) => action)).toContain('cloud.experiment-run.deleted');
      await history(id, '', otherOwner).expect(200, { entries: [], labels: [] });
    });
  });
  describe('one test at a time', () => {
    const runs = (accountId: string) => `/api/cloud/accounts/${accountId}/experiment-runs`;
    const startRun = (accountId: string, body: object = {}) => http().post(runs(accountId)).set('Cookie', developer).send(body);
    const detail = async (accountId: string, runId: string) =>
      (await http().get(`${runs(accountId)}/${runId}`).set('Cookie', viewer).expect(200)).body;
    const advance = (runId: string) => context.app.get(RunSequencer).advance(context.acme.tenant.id, runId);
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const setOnItems = (runId: string, field: string, minutes: number) =>
      context.owner
        .updateTable('experiment_runs')
        .set({
          items: sql`(select jsonb_agg(case when item ? ${field}::text then item || jsonb_build_object(${field}::text, ${ago(minutes)}::text) else item end) from jsonb_array_elements(items) item)`,
        })
        .where('id', '=', runId)
        .execute();

    const endedNow = (id: string, state: ExperimentState) => ({ ...record(id, id.replace('RUN', ''), state), endedAt: new Date().toISOString() });

    beforeEach(() => {
      source.listTemplates.mockResolvedValue([TEMPLATE, SECOND, THIRD]);
      source.listExperiments.mockResolvedValue([]);
      source.getExperiment.mockImplementation(async (_context, id) => endedNow(id, 'completed'));
      source.start.mockImplementation(async (_context, templateId) => `RUN${templateId}`);
      source.footprint.mockImplementation((template) => ({ ...FOOTPRINT, zoneWide: template.id === 'EXT1' }));
    });

    it('shows the tests in run order, zone-wide ones last, and whether the environment is busy', async () => {
      const { id } = await addAccount('Staging');
      const { body } = await http().get(`${runs(id)}/order`).set('Cookie', viewer).expect(200);
      expect(body).toEqual({
        tests: [
          { label: 'Cache reboot', zoneWide: false },
          { label: 'Zone outage', zoneWide: false },
          { label: 'Database failover', zoneWide: true },
        ],
        busy: null,
      });
      source.listExperiments.mockResolvedValue([summary('OUT1', 'EXT9', 'running')]);
      const { body: busy } = await http().get(`${runs(id)}/order`).set('Cookie', viewer).expect(200);
      expect(busy.busy).toBe('Experiment OUT1 is running in Staging account.');
    });

    it('starts each test only after the previous one ended and the environment is healthy again', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await startRun(id).expect(201);
      expect(source.start).toHaveBeenLastCalledWith(expect.anything(), 'EXT2', expect.any(String));

      source.environmentHealth.mockResolvedValue(['game-api: 1 of 2 tasks running']);
      await advance(run.id);
      let body = await detail(id, run.id);
      expect(body.items[0]).toMatchObject({ experimentId: 'RUNEXT2', settling: true, endedAt: expect.any(String) });
      expect(body.items[1].note).toBe('Waiting for the environment to be healthy: game-api: 1 of 2 tasks running');
      expect(source.start).toHaveBeenCalledTimes(1);

      source.environmentHealth.mockResolvedValue([]);
      await advance(run.id);
      body = await detail(id, run.id);
      expect(body.items.map(({ experimentId }: { experimentId: string | null }) => experimentId)).toEqual(['RUNEXT2', 'RUNEXT3', null]);
      expect(body.items[0].healthyAt).toEqual(expect.any(String));
      await advance(run.id);
      await advance(run.id);
      expect(source.start).toHaveBeenLastCalledWith(expect.anything(), 'EXT1', expect.any(String));
      expect(source.start).toHaveBeenCalledTimes(3);
    });

    it('stops the run when the environment is still unhealthy 30 minutes after a test', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await startRun(id).expect(201);
      source.environmentHealth.mockResolvedValue(['Database staging-db is rebooting']);
      await advance(run.id);
      await setOnItems(run.id, 'endedAt', 31);
      await advance(run.id);
      const body = await detail(id, run.id);
      expect(body.stoppedReason).toBe(
        "Stopped: the environment wasn't healthy 30 minutes after Cache reboot. Database staging-db is rebooting.",
      );
      expect(body.items.slice(1).map(({ cancelled }: { cancelled?: boolean }) => cancelled)).toEqual([true, true]);
      await advance(run.id);
      expect(source.start).toHaveBeenCalledTimes(1);
    });

    it('waits for a healthy environment before the first test, and stops after 30 minutes', async () => {
      const { id } = await addAccount('Staging');
      source.environmentHealth.mockResolvedValue(['Stop alarm staging-errors is ALARM']);
      const { body: run } = await startRun(id).expect(201);
      expect(source.start).not.toHaveBeenCalled();
      expect((await detail(id, run.id)).items[0]).toMatchObject({ waiting: true, gateSince: expect.any(String) });
      await setOnItems(run.id, 'gateSince', 31);
      await advance(run.id);
      expect((await detail(id, run.id)).stoppedReason).toBe(
        "Stopped: the environment wasn't healthy 30 minutes before Cache reboot. Stop alarm staging-errors is ALARM.",
      );
    });

    it('skips a test whose targets are not ready, with the reason, and goes on', async () => {
      const { id } = await addAccount('Staging');
      const resource = await context.owner.selectFrom('resources').select('id').where('cloud_account_id', '=', id).executeTakeFirstOrThrow();
      source.footprint.mockImplementation((template) => ({
        ...FOOTPRINT,
        resources: template.id === 'EXT2' ? [{ key: `rds-instance|${resource.id}`, name: 'staging-db' }] : [],
      }));
      source.notReady.mockResolvedValue("staging-db isn't available (rebooting)");
      const { body: run } = await startRun(id).expect(201);
      await advance(run.id);
      const body = await detail(id, run.id);
      expect(body.items[1]).toMatchObject({ templateId: 'EXT2', waiting: false, skipped: "staging-db isn't available (rebooting)" });
      expect(source.start.mock.calls.map(([, templateId]) => templateId)).toEqual(['EXT1', 'EXT3']);
    });

    it('starts servers a failed test left stopped, and says so in the report', async () => {
      const { id } = await addAccount('Staging');
      source.footprint.mockImplementation(() => ({ ...FOOTPRINT, stopsInstances: true }));
      source.getExperiment.mockImplementation(async (_context, experimentId) => endedNow(experimentId, 'failed'));
      source.resolvedTargets.mockResolvedValue(['arn:aws:ec2:eu-central-1:1:instance/i-0abc']);
      source.restartStopped.mockResolvedValueOnce({ started: [], waiting: ['i-0abc'] });
      source.restartStopped.mockResolvedValueOnce({ started: ['i-0abc'], waiting: [] });
      const { body: run } = await startRun(id).expect(201);
      await advance(run.id);
      expect((await detail(id, run.id)).items[0]).toMatchObject({ repairPending: true, settling: true });
      expect(source.start).toHaveBeenCalledTimes(1);
      await advance(run.id);
      const body = await detail(id, run.id);
      expect(body.items[0]).toMatchObject({ repairPending: false, repairs: [{ at: expect.any(String), text: 'Started i-0abc again' }] });
      expect(source.start).toHaveBeenCalledTimes(2);
      const { body: history } = await http().get(`/api/experiment-reports?account=${id}`).set('Cookie', viewer).expect(200);
      expect(history.entries.find(({ id: entryId }: { id: string }) => entryId === run.id)?.counts).toMatchObject({ repairs: 1 });
    });

    it('asks to start a server by hand when it does not start within 30 minutes', async () => {
      const { id } = await addAccount('Staging');
      source.footprint.mockImplementation(() => ({ ...FOOTPRINT, stopsInstances: true }));
      source.getExperiment.mockImplementation(async (_context, experimentId) => endedNow(experimentId, 'stopped'));
      source.resolvedTargets.mockResolvedValue(['i-0abc']);
      source.restartStopped.mockResolvedValue({ started: [], waiting: ['i-0abc'] });
      const { body: run } = await startRun(id).expect(201);
      await advance(run.id);
      await setOnItems(run.id, 'endedAt', 31);
      await advance(run.id);
      expect((await detail(id, run.id)).items[0].repairs).toEqual([{ at: null, text: "Couldn't start i-0abc again; start it by hand" }]);
    });

    it('never starts a test while another runs in the environment', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await startRun(id).expect(201);
      source.listExperiments.mockResolvedValue([summary('RUNEXT2', 'EXT2', 'running')]);
      const single = await http().post(`/api/cloud/accounts/${id}/experiments`).set('Cookie', developer).send({ region: REGION, templateId: 'EXT1' });
      expect(single.status).toBe(409);
      expect(single.body.message).toMatch(/^Only one failover test runs at a time in an environment\./);

      const other = await addAccount('Staging');
      source.listExperiments.mockResolvedValue([]);
      const { body: second } = await startRun(other.id).expect(201);
      expect(source.start).toHaveBeenCalledTimes(1);
      expect((await detail(other.id, second.id)).items[0].note).toBe(
        `Waiting: The run "All tests" is running a test in this environment.`,
      );
      await advance(run.id);
      await advance(second.id);
      expect(source.start).toHaveBeenCalledTimes(2);
    });

    it('refuses to start in production while anything else runs there', async () => {
      await setExtraPermissions(context, context.acme, 'developer', ['experiment.run', 'production.experiment.run']);
      const { id } = await addAccount('Production');
      source.listExperiments.mockResolvedValue([summary('OUT1', 'EXT9', 'running')]);
      const refused = await startRun(id, { confirmProduction: true });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toBe("Production is busy, so the run didn't start. Experiment OUT1 is running in Production account.");
      expect(source.start).not.toHaveBeenCalled();
    });
  });
});
