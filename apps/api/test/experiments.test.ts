import type { ExperimentState, ExperimentSummary } from '@pulsegrid/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { ExperimentReportCapture } from '../src/inventory/experiments/experiment-report-capture';
import { ExperimentWaves } from '../src/inventory/experiments/experiment-waves';
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
  concurrencyLimit: vi.fn<ExperimentSource['concurrencyLimit']>(),
  isQuotaFull: (error: unknown) => (error as Error).name === 'ServiceQuotaExceededException',
  footprint: vi.fn<ExperimentSource['footprint']>(),
  isRecovered: vi.fn<ExperimentSource['isRecovered']>(),
  failureMessage: () => 'AWS refused this experiment.',
};
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
    source.concurrencyLimit.mockResolvedValue({ limit: 5, known: true });
    source.footprint.mockReturnValue({ resources: [], zoneWide: false });
    source.isRecovered.mockResolvedValue(true);
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

    it('runs a group with one click and reports templates that did not start', async () => {
      const { id } = await addAccount('Staging');
      const templates = [...both, { region: REGION, templateId: 'GONE' }];
      const { body: group } = await createGroup(id, templates).expect(201);
      source.start.mockImplementation(async (_context, templateId) => {
        if (templateId === 'EXT2') {
          throw Object.assign(new Error('raw'), { name: 'ValidationException' });
        }
        return 'RUNEXT1';
      });
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({ groupId: group.id, waveSize: 5 }).expect(201);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'running')]);
      const { body: detail } = await http().get(`${runs(id)}/${run.id}`).set('Cookie', viewer).expect(200);
      expect(detail).toMatchObject({ label: 'Data layer', startedBy: 'dev@example.test', error: null });
      expect(detail.items).toEqual([
        { region: REGION, templateId: 'EXT1', label: 'Database failover', experimentId: 'RUNEXT1', error: null, waiting: false, note: null, resources: [], zoneWide: false, state: 'running', report: null },
        { region: REGION, templateId: 'EXT2', label: 'Cache reboot', experimentId: null, error: 'AWS refused this experiment.', waiting: false, note: null, resources: [], zoneWide: false, state: null, report: null },
        { region: REGION, templateId: 'GONE', label: 'GONE', experimentId: null, error: 'This template no longer exists in AWS.', state: null, report: null },
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
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({ waveSize: 5 }).expect(201);
      expect(source.start).toHaveBeenCalledTimes(2);
      source.listExperiments.mockResolvedValue([]);
      source.getExperiment.mockResolvedValue(null);
      const { body: detail } = await http().get(`${runs(id)}/${run.id}`).set('Cookie', viewer).expect(200);
      expect(detail.label).toBe('All tests');
      expect(detail.items.map(({ experimentId }: { experimentId: string }) => experimentId)).toEqual(['RUNEXT1', 'RUNEXT2']);
      source.listTemplates.mockResolvedValue([]);
      const empty = await http().post(runs(id)).set('Cookie', developer).send({ waveSize: 5 });
      expect(empty.status).toBe(409);
      expect(empty.body.message).toBe('There are no failover test templates to run.');
    });

    it('stops every experiment of a run that is still active', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({ waveSize: 5 }).expect(201);
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
      const refused = await http().post(runs(id)).set('Cookie', developer).send({ waveSize: 5 });
      expect(refused.status).toBe(403);
      expect(source.start).not.toHaveBeenCalled();
      await setExtraPermissions(context, context.acme, 'developer', ['experiment.run', 'production.experiment.run']);
      await createGroup(id).expect(201);
      await http().post(runs(id)).set('Cookie', developer).send({ waveSize: 5 }).expect(201);
      const staging = await addAccount('Staging');
      const { body: run } = await http().post(runs(staging.id)).set('Cookie', developer).send({ waveSize: 5 }).expect(201);
      await http().get(`${runs(staging.id)}/${run.id}`).set('Cookie', otherOwner).expect(404);
      await http().post(runs(staging.id)).set('Cookie', viewer).send({ waveSize: 5 }).expect(403);
      await http().post(runs(staging.id)).set('Cookie', developer).send({ groupId: 'nope', waveSize: 5 }).expect(400);
    });
  });
  describe('reports', () => {
    const runs = (accountId: string) => `/api/cloud/accounts/${accountId}/experiment-runs`;
    const history = (accountId: string, query = '', cookie = viewer) =>
      http().get(`/api/experiment-reports?account=${accountId}${query}`).set('Cookie', cookie);
    const capture = (accountId: string) =>
      context.app.get(ExperimentReportCapture).captureAccount({ tenantId: context.acme.tenant.id, accountId });
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
      const { body: started } = await http().post(runs(id)).set('Cookie', developer).send({ waveSize: 5 }).expect(201);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'running'), summary('RUNEXT2', 'EXT2', 'running')]);
      const { body: live } = await http().get(`${runs(id)}/${started.id}`).set('Cookie', viewer).expect(200);
      expect(live).toMatchObject({ result: 'running', endedAt: null, environmentName: 'Staging' });

      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'completed'), summary('RUNEXT2', 'EXT2', 'stopped')]);
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
        counts: { total: 2, passed: 1, stopped: 1, failed: 0, notStarted: 0 },
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
      const { body: started } = await http().post(runs(id)).set('Cookie', developer).send({ waveSize: 5 }).expect(201);
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
  describe('waves', () => {
    const runs = (accountId: string) => `/api/cloud/accounts/${accountId}/experiment-runs`;
    const startRun = (accountId: string, waveSize: number) =>
      http().post(runs(accountId)).set('Cookie', developer).send({ waveSize });
    const detail = async (accountId: string, runId: string) =>
      (await http().get(`${runs(accountId)}/${runId}`).set('Cookie', viewer).expect(200)).body;
    const advanceAll = () => context.app.get(ExperimentWaves).advanceAll();
    const advance = (runId: string) => context.app.get(ExperimentWaves).advance(context.acme.tenant.id, runId);
    const stages = (body: { items: { experimentId: string | null; waiting?: boolean; cancelled?: boolean }[] }) =>
      body.items.map(({ experimentId, waiting, cancelled }) => (waiting ? 'waiting' : cancelled ? 'cancelled' : experimentId));

    beforeEach(() => {
      source.listTemplates.mockResolvedValue([TEMPLATE, SECOND, THIRD]);
      source.listExperiments.mockResolvedValue([]);
      source.getExperiment.mockResolvedValue(null);
      source.start.mockImplementation(async (_context, templateId) => `RUN${templateId}`);
    });

    it('shows the quota and what is running, for the dialog', async () => {
      const { id } = await addAccount('Staging');
      source.concurrencyLimit.mockResolvedValue({ limit: 10, known: true });
      source.listExperiments.mockResolvedValue([summary('OUT1', 'EXT9', 'running'), summary('OLD', 'EXT9', 'completed')]);
      const { body } = await http().get(`${runs(id)}/capacity`).set('Cookie', viewer).expect(200);
      expect(body).toEqual([{ region: REGION, quota: 10, quotaKnown: true, running: 1 }]);
    });

    it('starts the first wave at once and the next as tests end', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await startRun(id, 2).expect(201);
      expect(source.start).toHaveBeenCalledTimes(2);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'running'), summary('RUNEXT2', 'EXT2', 'running')]);
      const live = await detail(id, run.id);
      expect(stages(live)).toEqual(['RUNEXT1', 'RUNEXT2', 'waiting']);
      expect(live).toMatchObject({ result: 'running', waveSize: 2 });

      await advance(run.id);
      expect(stages(await detail(id, run.id))).toEqual(['RUNEXT1', 'RUNEXT2', 'waiting']);

      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'completed'), summary('RUNEXT2', 'EXT2', 'running')]);
      await advanceAll();
      expect(stages(await detail(id, run.id))).toEqual(['RUNEXT1', 'RUNEXT2', 'RUNEXT3']);
      const [event] = await actions('RUNEXT3');
      expect(event).toEqual({ action: 'cloud.experiment.started', actor_email: 'dev@example.test' });
    });

    it('stays within the account quota, counting tests started elsewhere', async () => {
      const { id } = await addAccount('Staging');
      source.concurrencyLimit.mockResolvedValue({ limit: 2, known: true });
      source.listExperiments.mockResolvedValue([summary('OUT1', 'EXT9', 'running')]);
      const { body: run } = await startRun(id, 5).expect(201);
      expect(stages(await detail(id, run.id))).toEqual(['RUNEXT1', 'waiting', 'waiting']);
    });

    it('keeps a test waiting when AWS says the quota is full, instead of failing it', async () => {
      const { id } = await addAccount('Staging');
      source.start.mockImplementation(async (_context, templateId) => {
        if (templateId === 'EXT2') {
          throw Object.assign(new Error('full'), { name: 'ServiceQuotaExceededException' });
        }
        return `RUN${templateId}`;
      });
      const { body: run } = await startRun(id, 3).expect(201);
      const body = await detail(id, run.id);
      expect(stages(body)).toEqual(['RUNEXT1', 'waiting', 'waiting']);
      expect(body.items.every(({ error }: { error: string | null }) => error === null)).toBe(true);
    });

    it('cancels waiting tests on Stop all, which counts the run as stopped', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await startRun(id, 1).expect(201);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'running')]);
      await http().post(`${runs(id)}/${run.id}/stop`).set('Cookie', developer).expect(204);
      expect(source.stop).toHaveBeenCalledWith({ credentials: KEY, region: REGION }, 'RUNEXT1');
      source.start.mockClear();
      source.listExperiments.mockResolvedValue([]);
      await advance(run.id);
      expect(source.start).not.toHaveBeenCalled();
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'stopped')]);
      source.getExperiment.mockResolvedValue(record('RUNEXT1', 'EXT1', 'stopped'));
      const body = await detail(id, run.id);
      expect(stages(body)).toEqual(['RUNEXT1', 'cancelled', 'cancelled']);
      expect(body.result).toBe('stopped');
      const { body: history } = await http().get(`/api/experiment-reports?account=${id}`).set('Cookie', viewer).expect(200);
      expect(history.entries.find(({ id: entryId }: { id: string }) => entryId === run.id)?.counts).toMatchObject({
        total: 3,
        stopped: 1,
        cancelled: 2,
        notStarted: 0,
      });
    });

    it('refuses a wave size outside 1 to 25, and remembers a group last one', async () => {
      const { id } = await addAccount('Staging');
      await startRun(id, 0).expect(400);
      await startRun(id, 26).expect(400);
      const { body: group } = await http()
        .post(`/api/cloud/accounts/${id}/experiment-groups`)
        .set('Cookie', developer)
        .send({ name: 'Zones', templates: [{ region: REGION, templateId: 'EXT1' }] })
        .expect(201);
      expect(group.waveSize).toBeNull();
      await http().post(runs(id)).set('Cookie', developer).send({ groupId: group.id, waveSize: 1 }).expect(201);
      const { body: view } = await http().get(`/api/cloud/accounts/${id}/experiments`).set('Cookie', viewer).expect(200);
      expect(view.groups.find(({ id: groupId }: { id: string }) => groupId === group.id)?.waveSize).toBe(1);
    });
  });
  describe('tests on one resource', () => {
    const runs = (accountId: string) => `/api/cloud/accounts/${accountId}/experiment-runs`;
    const db = { key: 'rds-instance|db-1', name: 'staging-db' };
    const detail = async (accountId: string, runId: string) =>
      (await http().get(`${runs(accountId)}/${runId}`).set('Cookie', viewer).expect(200)).body;
    const advance = (runId: string) => context.app.get(ExperimentWaves).advance(context.acme.tenant.id, runId);
    const notes = (body: { items: { experimentId: string | null; note?: string | null }[] }) =>
      body.items.map(({ experimentId, note }) => experimentId ?? note);
    const endedMinutesAgo = (runId: string, minutes: number) =>
      context.owner
        .updateTable('experiment_runs')
        .set({
          items: sql`(select jsonb_agg(case when item ? 'endedAt' then item || jsonb_build_object('endedAt', ${new Date(Date.now() - minutes * 60_000).toISOString()}::text) else item end) from jsonb_array_elements(items) item)`,
        })
        .where('id', '=', runId)
        .execute();

    beforeEach(() => {
      source.listTemplates.mockResolvedValue([TEMPLATE, SECOND, THIRD]);
      source.listExperiments.mockResolvedValue([]);
      source.getExperiment.mockResolvedValue(null);
      source.start.mockImplementation(async (_context, templateId) => `RUN${templateId}`);
      source.footprint.mockImplementation((template) =>
        template.id === 'EXT3' ? { resources: [], zoneWide: true } : { resources: [db], zoneWide: false },
      );
    });

    it('shows the order before a run starts', async () => {
      const { id } = await addAccount('Staging');
      const { body } = await http().get(`${runs(id)}/order`).set('Cookie', viewer).expect(200);
      expect(body).toEqual({ tests: 3, sharing: 2, zoneWide: 1 });
    });

    it('runs tests on one database one after another, waits for it to recover, and the zone-wide test last', async () => {
      const { id } = await addAccount('Staging');
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({ waveSize: 5 }).expect(201);
      expect(source.start).toHaveBeenCalledTimes(1);
      source.listExperiments.mockResolvedValue([summary('RUNEXT1', 'EXT1', 'running')]);
      await advance(run.id);
      expect(notes(await detail(id, run.id))).toEqual([
        'RUNEXT1',
        'Waiting for the test on staging-db to finish.',
        'Zone-wide test: runs alone after the others finish and recover.',
      ]);

      source.listExperiments.mockResolvedValue([]);
      await advance(run.id);
      expect(notes(await detail(id, run.id))[1]).toBe('Waiting for staging-db to recover.');

      await endedMinutesAgo(run.id, 3);
      await advance(run.id);
      expect(notes(await detail(id, run.id))).toEqual([
        'RUNEXT1',
        'RUNEXT2',
        'Zone-wide test: runs alone after the others finish and recover.',
      ]);

      await advance(run.id);
      await endedMinutesAgo(run.id, 3);
      await advance(run.id);
      expect(notes(await detail(id, run.id))).toEqual(['RUNEXT1', 'RUNEXT2', 'RUNEXT3']);
    });

    it('cancels tests waiting for a resource that does not recover within 30 minutes', async () => {
      const { id } = await addAccount('Staging');
      source.isRecovered.mockResolvedValue(false);
      const resource = await context.owner
        .selectFrom('resources')
        .select('id')
        .where('cloud_account_id', '=', id)
        .executeTakeFirstOrThrow();
      const known = { key: `rds-instance|${resource.id}`, name: 'staging-db' };
      source.footprint.mockImplementation(() => ({ resources: [known], zoneWide: false }));
      const { body: run } = await http().post(runs(id)).set('Cookie', developer).send({ waveSize: 5 }).expect(201);
      await advance(run.id);
      await endedMinutesAgo(run.id, 31);
      await advance(run.id);
      const body = await detail(id, run.id);
      expect(body.items[1]).toMatchObject({ cancelled: true, note: "Cancelled: staging-db didn't recover within 30 minutes." });
    });
  });
});
