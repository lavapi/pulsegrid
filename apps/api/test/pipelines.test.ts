import type { PipelineRun } from '@pulsegrid/shared';
import type Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REDIS } from '../src/redis/redis.module';
import { GIT_PROVIDER_LIST, type GitClient, type GitProvider, GitProviderError, type GitWorkflow } from '../src/pipelines/git/git-provider';
import { parseWorkflowDefinition } from '../src/pipelines/git/github/workflow-definition';
import { setExtraPermissions, signIn, startTestApp, type TestContext, user } from './support/test-app';

const workflow = (id: string, name: string, repository = 'acme-org/api'): GitWorkflow => ({
  id,
  repository,
  name,
  path: `.github/workflows/${id}.yml`,
  url: 'https://github.com/x',
});

const run = (workflowId: string, id: string, status: PipelineRun['status'], startedAt: string): PipelineRun => ({
  id,
  workflowId,
  workflowName: 'name',
  repository: 'acme-org/api',
  number: 1,
  title: 'Commit title',
  branch: 'main',
  commit: 'abc1234',
  event: 'push',
  actor: 'person',
  status,
  startedAt,
  finishedAt: null,
  durationSeconds: null,
  url: 'https://github.com/run',
});

const state = {
  repositories: [] as string[],
  workflows: {} as Record<string, GitWorkflow[]>,
  runs: {} as Record<string, PipelineRun[]>,
  repositoryError: null as Error | null,
  runsError: null as Error | null,
  repositoryCalls: 0,
  files: {} as Record<string, string>,
  actions: [] as string[],
};

const provider: GitClient = {
  checkAccess: async () => ({ account: 'bot', repositories: 1, canRun: true }),
  listRepositories: async () => {
    state.repositoryCalls += 1;
    if (state.repositoryError) {
      throw state.repositoryError;
    }
    return state.repositories.map((fullName) => ({ fullName }));
  },
  listWorkflows: async (repository) => state.workflows[repository] ?? [],
  listRuns: async (repository, workflowId) => {
    if (state.runsError) {
      throw state.runsError;
    }
    const runs = state.runs[repository] ?? [];
    return workflowId ? runs.filter((item) => item.workflowId === workflowId) : runs;
  },
  getRun: async (repository, runId) => {
    const found = (state.runs[repository] ?? []).find(({ id }) => id === runId);
    if (!found) {
      throw new GitProviderError("The GitHub token can't read this. Check its permissions.");
    }
    return found;
  },
  listJobs: async () => [
    { id: '1', name: 'build', status: 'running', durationSeconds: null, url: 'u', steps: [] },
  ],
  getRepository: async () => ({ defaultBranch: 'main' }),
  listBranches: async () => ['main', 'dev'],
  readDefinition: async ({ repository, path }, ref) => {
    const content = state.files[`${repository}:${path}@${ref}`] ?? state.files[`${repository}:${path}`];
    return content === undefined ? null : parseWorkflowDefinition(content);
  },
  startRun: async (repository, workflowId, branch, inputs) => {
    state.actions.push(`start:${repository}:${workflowId}:${branch}:${JSON.stringify(inputs)}`);
  },
  rerun: async (repository, runId, failedOnly) => {
    state.actions.push(`rerun:${repository}:${runId}:${failedOnly}`);
  },
  cancel: async (repository, runId) => {
    state.actions.push(`cancel:${repository}:${runId}`);
  },
};

const gitProvider: GitProvider = {
  id: 'github',
  parseCredentials: (input) => input as Record<string, string>,
  credentialHint: () => '…oken',
  connect: () => provider,
};

describe('pipelines', () => {
  let context: TestContext;
  let admin: string;
  let viewer: string;
  let other: string;
  let flushed = 0;
  let connectionId: string;
  const http = () => request(context.app.getHttpServer());

  const reset = (repositories: string[]) => {
    flushed += 1;
    const suffix = `-${flushed}`;
    state.repositories = repositories.map((name) => `${name}${suffix}`);
    return suffix;
  };
  const appFor = async (repository: string): Promise<string> => {
    const { id } = await context.owner
      .insertInto('pipeline_apps')
      .values({
        tenant_id: context.acme.tenant.id,
        name: repository,
        repository,
        connection_id: connectionId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder.overrideProvider(GIT_PROVIDER_LIST).useValue([gitProvider]),
    );
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    other = await signIn(context, context.globex, user('gia', 'admin'));
    const { body } = await http()
      .post('/api/git/connections')
      .set('Cookie', admin)
      .send({ provider: 'github', name: 'Acme', organization: 'acme-org', credentials: { token: 'test-token' } })
      .expect(201);
    connectionId = body.id;
  });
  afterAll(() => context.close());

  beforeEach(async () => {
    state.repositoryError = null;
    state.runsError = null;
    state.actions = [];
    await context.app.get<Redis>(REDIS).flushdb();
    await context.owner.deleteFrom('pipeline_apps').execute();
    await context.owner.deleteFrom('environments').execute();
  });

  const detail = async (appId: string) =>
    (await http().get(`/api/pipelines/apps/${appId}`).set('Cookie', viewer).expect(200)).body;

  it('never shows the connection to another tenant', async () => {
    const appId = await appFor('acme-org/api');
    const { body } = await http().get('/api/pipelines/apps').set('Cookie', other).expect(200);
    expect(body).toEqual({ configured: false, apps: [], issues: [] });
    await http().get(`/api/pipelines/run?app=${appId}&run=1`).set('Cookie', other).expect(404);
  });

  it('lists pipelines with their latest run, active and failed first', async () => {
    const suffix = reset(['acme-org/api']);
    const repository = `acme-org/api${suffix}`;
    state.workflows[repository] = [
      workflow('1', 'Passing', repository),
      workflow('2', 'Failing', repository),
      workflow('3', 'Running', repository),
      workflow('4', 'Never ran', repository),
    ];
    state.runs[repository] = [
      run('3', '30', 'running', '2026-11-04T12:00:00Z'),
      run('2', '20', 'failure', '2026-11-04T11:00:00Z'),
      run('1', '11', 'success', '2026-11-04T10:00:00Z'),
      run('1', '10', 'failure', '2026-11-04T09:00:00Z'),
    ];

    const { pipelines } = await detail(await appFor(repository));

    expect(pipelines.map((item: { name: string }) => item.name)).toEqual([
      'Running',
      'Failing',
      'Passing',
      'Never ran',
    ]);
    expect(pipelines[2].latestRun.id).toBe('11');
    expect(pipelines[3].latestRun).toBeNull();
  });

  it('shows nothing for repositories with no workflows', async () => {
    const suffix = reset(['acme-org/empty']);
    state.workflows[`acme-org/empty${suffix}`] = [];
    const { pipelines } = await detail(await appFor(`acme-org/empty${suffix}`));
    expect(pipelines).toEqual([]);
  });

  it('reports a friendly issue when a provider fails', async () => {
    const suffix = reset(['acme-org/good']);
    const repository = `acme-org/good${suffix}`;
    state.workflows[repository] = [workflow('1', 'CI', repository)];
    state.runsError = new GitProviderError('GitHub rate limit reached. Pipelines will refresh shortly.');
    const body = await detail(await appFor(repository));
    expect(body.issues).toEqual(['GitHub rate limit reached. Pipelines will refresh shortly.']);
    expect(JSON.stringify(body)).not.toContain('test-token');
  });

  it('caches repositories so a page refresh does not spend the rate limit', async () => {
    reset(['acme-org/cached']);
    await http().get('/api/pipelines/apps/repositories').set('Cookie', admin);
    const calls = state.repositoryCalls;
    await http().get('/api/pipelines/apps/repositories').set('Cookie', admin);
    expect(state.repositoryCalls).toBe(calls);
  });

  it('shows run history and details', async () => {
    const suffix = reset(['acme-org/history']);
    const repository = `acme-org/history${suffix}`;
    state.workflows[repository] = [workflow('5', 'CI', repository)];
    state.runs[repository] = [{ ...run('5', '50', 'running', '2026-11-04T12:00:00Z'), repository }];
    const appId = await appFor(repository);

    const history = await http()
      .get(`/api/pipelines/history?app=${appId}&workflow=5`)
      .set('Cookie', viewer)
      .expect(200);
    expect(history.body.pipeline).toMatchObject({ name: 'CI', appId });
    expect(history.body.runs).toHaveLength(1);

    const runDetail = await http()
      .get(`/api/pipelines/run?app=${appId}&run=50`)
      .set('Cookie', viewer)
      .expect(200);
    expect(runDetail.body.jobs[0].name).toBe('build');
  });

  it('rejects malformed requests with a friendly message', async () => {
    const response = await http().get('/api/pipelines/run?app=nope&run=../etc').set('Cookie', viewer);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('That pipeline request is not valid.');
  });

  it('returns a friendly error when the provider fails', async () => {
    const appId = await appFor('acme-org/api');
    const response = await http().get(`/api/pipelines/run?app=${appId}&run=999`).set('Cookie', viewer);
    expect(response.status).toBe(503);
    expect(response.body.message).toBe("The GitHub token can't read this. Check its permissions.");
  });

  describe('apps', () => {
    const repository = 'acme-org/shop';
    const create = (cookie: string, body: Record<string, unknown>) =>
      http().post('/api/pipelines/apps').set('Cookie', cookie).send({ connectionId, ...body });

    beforeEach(async () => {
      state.repositories = [repository, 'acme-org/other'];
      state.workflows[repository] = [workflow('1', 'Build', repository), workflow('2', 'Lint', repository)];
      state.workflows['acme-org/other'] = [workflow('3', 'Other', 'acme-org/other')];
      state.runs[repository] = [
        { ...run('1', '100', 'running', '2026-11-04T12:00:00Z'), repository },
        { ...run('2', '200', 'failure', '2026-11-04T11:00:00Z'), repository },
      ];
      state.runs['acme-org/other'] = [];
    });

    it('starts empty, and lists only unused repositories', async () => {
      const { body } = await http().get('/api/pipelines/apps').set('Cookie', viewer).expect(200);
      expect(body).toEqual({ configured: true, apps: [], issues: [] });
      await create(admin, { name: 'Shop', repository }).expect(201);
      const available = await http().get('/api/pipelines/apps/repositories').set('Cookie', admin).expect(200);
      expect(available.body).toEqual([
        { connectionId, connectionName: 'Acme', repository: 'acme-org/other' },
      ]);
    });

    it('shows a card with counts, and only that app has its pipelines', async () => {
      const { body: app } = await create(admin, { name: '  Shop  ', repository }).expect(201);
      expect(app.name).toBe('Shop');
      const { body } = await http().get('/api/pipelines/apps').set('Cookie', viewer).expect(200);
      expect(body.apps).toEqual([{ ...app, pipelines: 2, running: 1, failed: 1, deployments: [] }]);
      const detail = await http().get(`/api/pipelines/apps/${app.id}`).set('Cookie', viewer).expect(200);
      expect(detail.body.pipelines.map(({ name }: { name: string }) => name)).toEqual(['Build', 'Lint']);
    });

    it('averages deployment time by environment, leaving out shared pipelines', async () => {
      await http().post('/api/environments').set('Cookie', admin).send({ name: 'Staging' }).expect(201);
      await http().post('/api/environments').set('Cookie', admin).send({ name: 'Production' }).expect(201);
      state.files[`${repository}:.github/workflows/1.yml`] =
        `on: push\njobs:\n  deploy:\n    environment: \${{ github.ref_name == 'main' && 'production' || 'staging' }}\n`;
      const finished = (id: string, branch: string, durationSeconds: number) => ({
        ...run('1', id, 'success', '2026-11-04T10:00:00Z'),
        repository,
        branch,
        durationSeconds,
      });
      state.runs[repository] = [
        finished('1', 'main', 100),
        finished('2', 'main', 200),
        finished('3', 'dev', 40),
        { ...finished('4', 'dev', 999), status: 'failure' as const },
        { ...finished('5', 'dev', 999), workflowId: '2' },
      ];
      const { body: app } = await create(admin, { name: 'Shop', repository }).expect(201);
      const expected = [
        { environmentName: 'Staging', averageSeconds: 40, runs: 1 },
        { environmentName: 'Production', averageSeconds: 150, runs: 2 },
      ];
      const list = await http().get('/api/pipelines/apps').set('Cookie', viewer).expect(200);
      expect(list.body.apps[0].deployments).toEqual(expected);
      const detail = await http().get(`/api/pipelines/apps/${app.id}`).set('Cookie', viewer).expect(200);
      expect(detail.body.deployments).toEqual(expected);
    });

    it('keeps the app page working when GitHub fails', async () => {
      await http().post('/api/environments').set('Cookie', admin).send({ name: 'Staging' }).expect(201);
      const { body: app } = await create(admin, { name: 'Shop', repository }).expect(201);
      state.runsError = new GitProviderError('GitHub is having problems.');
      const { body } = await http().get(`/api/pipelines/apps/${app.id}`).set('Cookie', viewer).expect(200);
      expect(body.deployments).toEqual([{ environmentName: 'Staging', averageSeconds: null, runs: 0 }]);
      expect(body.issues).toHaveLength(1);
    });

    it('links a pipeline back to its app', async () => {
      const { body: app } = await create(admin, { name: 'Shop', repository }).expect(201);
      const { body } = await http()
        .get('/api/pipelines/history')
        .query({ app: app.id, workflow: '1' })
        .set('Cookie', viewer)
        .expect(200);
      expect(body.app).toEqual(app);
    });

    it('refuses duplicate names and repositories', async () => {
      await create(admin, { name: 'Shop', repository }).expect(201);
      const name = await create(admin, { name: 'SHOP', repository: 'acme-org/other' }).expect(409);
      expect(name.body.message).toBe('An app with that name or repository already exists.');
      await create(admin, { name: 'Store', repository }).expect(409);
    });

    it('rejects repositories the token cannot read, and empty names', async () => {
      await create(admin, { name: 'Shop', repository: 'acme-org/missing' }).expect(400);
      await create(admin, { name: 'Shop', repository: 'someone/else' }).expect(400);
      await create(admin, { name: '   ', repository }).expect(400);
    });

    it('stops viewers creating and deleting apps', async () => {
      await create(viewer, { name: 'Shop', repository }).expect(403);
      const { body: app } = await create(admin, { name: 'Shop', repository }).expect(201);
      await http().delete(`/api/pipelines/apps/${app.id}`).set('Cookie', viewer).expect(403);
      await http().get('/api/pipelines/apps/repositories').set('Cookie', viewer).expect(403);
    });

    it('deletes an app and records it', async () => {
      const { body: app } = await create(admin, { name: 'Shop', repository }).expect(201);
      await http().delete(`/api/pipelines/apps/${app.id}`).set('Cookie', admin).expect(204);
      await http().get(`/api/pipelines/apps/${app.id}`).set('Cookie', admin).expect(404);
      await http().delete(`/api/pipelines/apps/${app.id}`).set('Cookie', admin).expect(404);
      const events = await context.owner
        .selectFrom('audit_events')
        .select('action')
        .where('target_id', '=', app.id)
        .execute();
      expect(events.map(({ action }) => action).sort()).toEqual(['pipeline.app_created', 'pipeline.app_deleted']);
    });

    it('never shows apps to another tenant', async () => {
      const { body: app } = await create(admin, { name: 'Shop', repository }).expect(201);
      await http().get(`/api/pipelines/apps/${app.id}`).set('Cookie', other).expect(404);
      const { body } = await http().get('/api/pipelines/apps').set('Cookie', other).expect(200);
      expect(body).toEqual({ configured: false, apps: [], issues: [] });
    });
  });

  describe('environment links', () => {
    const createEnvironment = async (name: string): Promise<string> =>
      (await http().post('/api/environments').set('Cookie', admin).send({ name }).expect(201)).body.id;

    it('links pipelines by name automatically', async () => {
      const suffix = reset(['acme-org/auto']);
      const repository = `acme-org/auto${suffix}`;
      state.workflows[repository] = [workflow('1', 'Deploy production', repository), workflow('2', 'Lint', repository)];
      await appFor(repository);
      const production = await createEnvironment('Production');

      const { body } = await http().get(`/api/pipelines/environment/${production}`).set('Cookie', viewer).expect(200);
      expect(body.map((item: { name: string }) => item.name)).toEqual(['Deploy production']);
    });

    it('lets an admin override the link and records it', async () => {
      const suffix = reset(['acme-org/manual']);
      const repository = `acme-org/manual${suffix}`;
      state.workflows[repository] = [workflow('1', 'Deploy production', repository)];
      const appId = await appFor(repository);
      const production = await createEnvironment('Production');
      const staging = await createEnvironment('Staging');

      await http()
        .put('/api/pipelines/link')
        .set('Cookie', admin)
        .send({ appId, workflowId: '1', environmentId: staging })
        .expect(204);

      const onStaging = await http().get(`/api/pipelines/environment/${staging}`).set('Cookie', viewer);
      const onProduction = await http().get(`/api/pipelines/environment/${production}`).set('Cookie', viewer);
      expect(onStaging.body).toHaveLength(1);
      expect(onProduction.body).toHaveLength(0);

      const audit = await http().get('/api/audit-events').set('Cookie', admin);
      expect(audit.body.events[0].action).toBe('pipeline.environment_linked');
    });

    it('lets an admin remove an automatic link', async () => {
      const suffix = reset(['acme-org/unlink']);
      const repository = `acme-org/unlink${suffix}`;
      state.workflows[repository] = [workflow('1', 'Deploy production', repository)];
      const appId = await appFor(repository);
      const production = await createEnvironment('Production');

      await http()
        .put('/api/pipelines/link')
        .set('Cookie', admin)
        .send({ appId, workflowId: '1', environmentId: null })
        .expect(204);

      const { body } = await http().get(`/api/pipelines/environment/${production}`).set('Cookie', viewer);
      expect(body).toEqual([]);
    });

    it('stops viewers changing links', async () => {
      const appId = await appFor('acme-org/api');
      await http()
        .put('/api/pipelines/link')
        .set('Cookie', viewer)
        .send({ appId, workflowId: '1', environmentId: null })
        .expect(403);
    });
  });

  describe('actions', () => {
    let developer: string;
    let appId: string;
    const repository = 'acme-org/deploys';
    const MANUAL = `on:\n  workflow_dispatch:\n    inputs:\n      target:\n        type: choice\n        required: true\n        options: [blue, green]\njobs: {}`;
    const PRODUCTION_FILE = `on: workflow_dispatch\njobs:\n  deploy:\n    environment: production\n`;

    const environment = async (name: string): Promise<string> =>
      (await http().post('/api/environments').set('Cookie', admin).send({ name }).expect(201)).body.id;
    const link = (workflowId: string, environmentId: string | null) =>
      http().put('/api/pipelines/link').set('Cookie', admin).send({ appId, workflowId, environmentId }).expect(204);
    const start = (cookie: string, body: Record<string, unknown>) =>
      http().post('/api/pipelines/runs').set('Cookie', cookie).send({ appId, branch: 'main', ...body });

    beforeAll(async () => {
      developer = await signIn(context, context.acme, user('dev', 'developer'));
    });

    beforeEach(async () => {
      appId = await appFor(repository);
      state.repositories = [repository];
      state.workflows[repository] = [
        workflow('1', 'Build', repository),
        workflow('2', 'Deploy', repository),
        workflow('3', 'No manual trigger', repository),
      ];
      state.runs[repository] = [
        run('1', '100', 'failure', '2026-11-04T12:00:00Z'),
        run('2', '200', 'running', '2026-11-04T12:00:00Z'),
      ].map((item) => ({ ...item, repository }));
      state.files = {
        [`${repository}:.github/workflows/1.yml`]: MANUAL,
        [`${repository}:.github/workflows/2.yml`]: PRODUCTION_FILE,
        [`${repository}:.github/workflows/3.yml`]: 'on: push\njobs: {}',
      };
    });

    it('treats a pipeline with no environment as production', async () => {
      await start(developer, { workflowId: '1', inputs: { target: 'blue' } }).expect(403);
      expect(state.actions).toEqual([]);
    });

    it('lets developers run non-production pipelines', async () => {
      const staging = await environment('Staging');
      await link('1', staging);
      await start(developer, { workflowId: '1', inputs: { target: 'blue' } }).expect(202);
      expect(state.actions).toEqual([`start:${repository}:1:main:{"target":"blue"}`]);

      const audit = await http().get('/api/audit-events').set('Cookie', admin);
      expect(audit.body.events[0]).toMatchObject({ action: 'pipeline.run_started', actorEmail: 'dev@example.test' });
      expect(audit.body.events[0].metadata).toMatchObject({ branch: 'main', production: false, environment: 'Staging' });
    });

    it('blocks viewers from every action', async () => {
      await start(viewer, { workflowId: '1' }).expect(403);
      await http().post('/api/pipelines/runs/rerun').set('Cookie', viewer).send({ appId, runId: '100' }).expect(403);
      await http().post('/api/pipelines/runs/cancel').set('Cookie', viewer).send({ appId, runId: '200' }).expect(403);
      expect(state.actions).toEqual([]);
    });

    it('needs the production permission for production, even if it is linked to staging', async () => {
      const staging = await environment('Staging');
      await environment('Production');
      await link('2', staging);

      const response = await start(developer, { workflowId: '2' });
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Ask your super admin for the Run production pipelines permission.');
      await http().post('/api/pipelines/runs/cancel').set('Cookie', developer).send({ appId, runId: '200' }).expect(403);
      expect(state.actions).toEqual([]);

      const audit = await http().get('/api/audit-events').set('Cookie', admin);
      expect(audit.body.events[0]).toMatchObject({ action: 'pipeline.action_denied', actorEmail: 'dev@example.test' });

      await setExtraPermissions(context, context.acme, 'developer', ['production.pipeline.run']);
      await start(developer, { workflowId: '2' }).expect(202);
      await start(admin, { workflowId: '2' }).expect(202);
      await setExtraPermissions(context, context.acme, 'developer', []);
    });

    it('only lets people who manage environments link pipelines', async () => {
      const staging = await environment('Staging');
      await http()
        .put('/api/pipelines/link')
        .set('Cookie', developer)
        .send({ appId, workflowId: '1', environmentId: staging })
        .expect(403);
    });

    it('treats a workflow named for production as production when linked to staging', async () => {
      state.workflows[repository] = [workflow('1', 'Deploy production', repository)];
      await link('1', await environment('Staging'));
      const response = await start(developer, { workflowId: '1', inputs: { target: 'blue' } });
      expect(response.status).toBe(403);
      expect(state.actions).toEqual([]);
    });

    it('keeps a renamed production environment production', async () => {
      const id = await environment('Production');
      await http().put(`/api/environments/${id}`).set('Cookie', admin).send({ name: 'Staging two' }).expect(200);
      await link('1', id);
      await start(developer, { workflowId: '1', inputs: { target: 'blue' } }).expect(403);
      expect(state.actions).toEqual([]);
    });

    it('refuses production re-runs without the production permission', async () => {
      await environment('Production');
      await http().post('/api/pipelines/runs/rerun').set('Cookie', developer).send({ appId, runId: '200' }).expect(403);
      expect(state.actions).toEqual([]);
    });

    it('fails closed for an environment it does not recognise', async () => {
      await link('1', await environment('Customer accounts'));
      await start(developer, { workflowId: '1', inputs: { target: 'blue' } }).expect(403);
      expect(state.actions).toEqual([]);
    });

    it('lists running pipelines and recent failures for the selected environment', async () => {
      const staging = await environment('Staging');
      await environment('Production');
      await link('1', staging);
      const recent = new Date().toISOString();
      state.runs[repository] = [
        { ...run('1', '100', 'running', recent), repository },
        { ...run('2', '200', 'failure', recent), repository, finishedAt: recent },
      ];
      const { body } = await http().get(`/api/pipelines/apps/activity?environment=${staging}`).set('Cookie', viewer).expect(200);
      expect(body.configured).toBe(true);
      expect(body.running.map(({ name, run: item }: { name: string; run: { id: string } }) => [name, item.id])).toEqual([['Build', '100']]);
      expect(body.running[0]).toMatchObject({ appId, environmentName: 'Staging' });
      expect(body.failed).toEqual([]);
    });

    it('re-runs only failed jobs when asked', async () => {
      const staging = await environment('Staging');
      await link('1', staging);
      await http()
        .post('/api/pipelines/runs/rerun')
        .set('Cookie', developer)
        .send({ appId, runId: '100', failedOnly: true })
        .expect(202);
      expect(state.actions).toEqual([`rerun:${repository}:100:true`]);
    });

    it('refuses pipelines without a manual trigger', async () => {
      const staging = await environment('Staging');
      await link('3', staging);
      const response = await start(admin, { workflowId: '3' });
      expect(response.status).toBe(409);
      expect(response.body.message).toBe("This pipeline can't be started manually.");
    });

    it('validates branch and inputs', async () => {
      const staging = await environment('Staging');
      await link('1', staging);
      const cases: [Record<string, unknown>, string][] = [
        [{ workflowId: '1', branch: 'gone', inputs: { target: 'blue' } }, 'That branch no longer exists.'],
        [{ workflowId: '1', inputs: {} }, 'Enter a value for target.'],
        [{ workflowId: '1', inputs: { target: 'red' } }, 'Choose a valid option for target.'],
        [{ workflowId: '1', inputs: { target: 'blue', extra: 'x' } }, "That form doesn't match this pipeline any more. Reload the page."],
      ];
      for (const [body, message] of cases) {
        const response = await start(developer, body);
        expect(response.status).toBe(400);
        expect(response.body.message).toBe(message);
      }
      expect(state.actions).toEqual([]);
    });

    it('rejects unsafe branch names', async () => {
      const response = await start(admin, { workflowId: '1', branch: 'a b' });
      expect(response.status).toBe(400);
    });

    it('never acts for another tenant', async () => {
      await start(other, { workflowId: '1' }).expect(404);
      expect(state.actions).toEqual([]);
    });

    it('tells the page what each role can do', async () => {
      const staging = await environment('Staging');
      await link('1', staging);
      const history = (workflowId: string, cookie: string) =>
        http().get(`/api/pipelines/history?app=${appId}&workflow=${workflowId}`).set('Cookie', cookie).expect(200);

      expect((await history('1', developer)).body.options.access).toEqual({
        canAct: true,
        production: false,
        reason: null,
      });
      expect((await history('1', viewer)).body.options.access.reason).toBe(
        'Ask your super admin for the Run staging pipelines permission.',
      );
      await environment('Production');
      const production = await history('2', developer);
      expect(production.body.options.access).toEqual({
        canAct: false,
        production: true,
        reason: 'Ask your super admin for the Run production pipelines permission.',
      });
      expect((await history('2', admin)).body.options.access).toMatchObject({ canAct: true, production: true });
      expect(production.body.options.definition.manual).toBe(true);
    });

    describe('pipelines that choose their environment by branch', () => {
      const ROUTED = `on: workflow_dispatch\njobs:\n  deploy:\n    environment: \${{ github.ref_name == 'main' && 'production' || 'staging' }}\n`;
      const rerun = (cookie: string, runId: string) =>
        http()
          .post('/api/pipelines/runs/rerun')
          .set('Cookie', cookie)
          .send({ appId, runId, failedOnly: false });
      const overview = async (scope: string) =>
        (await http().get(`/api/pipelines/apps/${appId}?environment=${scope}`).set('Cookie', viewer).expect(200)).body
          .pipelines as { name: string; latestRun: { id: string } | null; environmentName: string | null }[];
      const names = (pipelines: { name: string }[]) => pipelines.map(({ name }) => name).sort();
      let staging: string;
      let production: string;

      beforeEach(async () => {
        staging = await environment('Staging');
        production = await environment('Production');
        state.workflows[repository]?.push(workflow('4', 'Release', repository));
        state.files[`${repository}:.github/workflows/2.yml`] = ROUTED;
        state.files[`${repository}:.github/workflows/4.yml`] = PRODUCTION_FILE;
        state.runs[repository]?.push({
          ...run('2', '201', 'success', '2026-11-04T11:00:00Z'),
          repository,
          branch: 'dev',
        });
      });

      it('shows each account only its own pipelines and the shared ones', async () => {
        const stagingView = await overview(staging);
        expect(names(stagingView)).toEqual(['Build', 'Deploy', 'No manual trigger']);
        expect(names(await overview(production))).toEqual(['Build', 'Deploy', 'No manual trigger', 'Release']);
        expect(names(await overview('none'))).toEqual(['Build', 'No manual trigger']);
      });

      it('shows the latest run for the selected environment', async () => {
        const find = (pipelines: Awaited<ReturnType<typeof overview>>) =>
          pipelines.find(({ name }) => name === 'Deploy');
        expect(find(await overview(staging))).toMatchObject({
          environmentName: 'Staging',
          latestRun: { id: '201' },
        });
        expect(find(await overview(production))).toMatchObject({
          environmentName: 'Production',
          latestRun: { id: '200' },
        });
      });

      it('leaves shared pipelines off the environment page', async () => {
        const { body } = await http().get(`/api/pipelines/environment/${staging}`).set('Cookie', viewer);
        expect(body.map((item: { name: string }) => item.name)).toEqual(['Deploy']);
      });

      it('filters history and picks the branch for the selected environment', async () => {
        const query = { app: appId, workflow: '2', environment: staging };
        const { body } = await http().get('/api/pipelines/history').query(query).set('Cookie', developer);
        expect(body.runs.map(({ id }: { id: string }) => id)).toEqual(['201']);
        expect(body.options.defaultBranch).toBe('dev');
        expect(body.options.access).toMatchObject({ canAct: true, production: false });
        expect(body.options.branchAccess.matched).toMatchObject({ canAct: false, production: true });
      });

      it('lets developers act on staging runs but not production runs', async () => {
        await rerun(developer, '201').expect(202);
        await rerun(developer, '200').expect(403);
        await start(developer, { workflowId: '2', branch: 'dev' }).expect(202);
        await start(developer, { workflowId: '2', branch: 'main' }).expect(403);
        expect(state.actions).toHaveLength(2);
      });

      it('applies production rules to main, even when linked to staging', async () => {
        await link('2', staging);
        await rerun(developer, '200').expect(403);
        await rerun(admin, '200').expect(202);
      });

      it('finds the rule when only another branch has it', async () => {
        delete state.files[`${repository}:.github/workflows/2.yml`];
        state.files[`${repository}:.github/workflows/2.yml@main`] = 'on: push\njobs: {}';
        state.files[`${repository}:.github/workflows/2.yml@dev`] = ROUTED;
        await rerun(developer, '201').expect(202);
        await rerun(developer, '200').expect(403);
      });

      it('shows the environment of a run', async () => {
        const query = { app: appId, run: '201' };
        const { body } = await http().get('/api/pipelines/run').query(query).set('Cookie', developer);
        expect(body).toMatchObject({ environmentName: 'Staging', access: { production: false } });
      });
    });

    it('links pipelines from the environment in the workflow file', async () => {
      const production = await environment('Production');
      const { body } = await http().get(`/api/pipelines/environment/${production}`).set('Cookie', viewer);
      expect(body.map((item: { name: string }) => item.name)).toEqual(['Deploy']);
    });
  });
});
