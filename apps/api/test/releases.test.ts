import type { PipelineJob, PipelineRun, ReleaseChoices, ReleasesOverview } from '@pulsegrid/shared';
import type Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import { CLOUD_PROVIDER_LIST, type CloudProvider, type Deployment } from '../src/inventory/providers/provider';
import { GIT_PROVIDER_LIST, type GitClient, type GitProvider } from '../src/pipelines/git/git-provider';
import { REDIS } from '../src/redis/redis.module';
import { signIn, startTestApp, type TestContext, type TestTenant, user, TEST_ROLE, TEST_SESSION } from './support/test-app';
import { newEnvironment } from '../src/inventory/environments/account-environment';

const REPOSITORY = 'acme-org/api';
const SERVICE = 'arn:aws:ecs:eu-central-1:1:service/main/api';
const WORKFLOW = { id: 'deploy', repository: REPOSITORY, name: 'Deploy', path: '.github/workflows/deploy.yml', url: 'u' };
const START = new Date(Date.now() - 10 * 60 * 1000).toISOString();

const run: PipelineRun = {
  id: '7',
  workflowId: 'deploy',
  workflowName: 'Deploy',
  repository: REPOSITORY,
  number: 7,
  title: 'Fix login',
  branch: 'develop',
  commit: 'abc1234',
  event: 'push',
  actor: 'person',
  status: 'success',
  startedAt: START,
  finishedAt: new Date().toISOString(),
  durationSeconds: 300,
  url: 'u',
};
const jobs: PipelineJob[] = [
  { id: '1', name: 'build', status: 'success', durationSeconds: 60, url: 'u', steps: [] },
  { id: '2', name: 'test', status: 'success', durationSeconds: 90, url: 'u', steps: [] },
];
const rollout: Deployment = {
  state: 'running',
  startedAt: START,
  finishedAt: null,
  runningTasks: 1,
  desiredTasks: 2,
  images: ['repo/api:abc1234'],
  targetLabel: 'ECS Fargate',
  traffic: null,
};

const client = {
  checkAccess: async () => ({ account: 'bot', repositories: 1, canRun: true }),
  listRepositories: async () => [{ fullName: REPOSITORY }],
  listWorkflows: async () => [WORKFLOW],
  listRuns: async () => [run],
  listJobs: async () => jobs,
  getRepository: async () => ({ defaultBranch: 'develop' }),
  listBranches: async () => ['develop'],
  readDefinition: async () => null,
} as unknown as GitClient;
const git: GitProvider = {
  id: 'github',
  parseCredentials: (input) => input as Record<string, string>,
  credentialHint: () => '…oken',
  connect: () => client,
};
const read = vi.fn<(context: unknown) => Promise<Deployment | null>>();
const cloud: CloudProvider = {
  ...awsProvider,
  deploymentSource: {
    resourceType: 'ecs-service',
    read,
    recent: async () => ({ strategy: 'rolling', deployments: [], error: null }),
    failureMessage: () => 'AWS refused this.',
  },
};

describe('releases', () => {
  let context: TestContext;
  let admin: string;
  let viewer: string;
  let other: string;
  let appId: string;
  let stagingAccount: string;
  let productionAccount: string;
  const http = () => request(context.app.getHttpServer());
  const target = (accountId: string, nativeId = SERVICE) => ({
    appId,
    workflowId: 'deploy',
    accountId,
    nativeId,
  });
  const link = (body: object, cookie = admin) =>
    http().post('/api/releases/targets').set('Cookie', cookie).send(body);
  const list = (accountId: string, cookie = admin) =>
    http().get(`/api/releases?account=${accountId}`).set('Cookie', cookie);
  const overview = async (cookie = admin, accountId = stagingAccount) =>
    ((await list(accountId, cookie).expect(200)) as { body: ReleasesOverview }).body;
  const choices = (accountId: string, cookie = admin) =>
    http().get(`/api/releases/choices?account=${accountId}`).set('Cookie', cookie);

  const addAccount = async ({ tenant }: TestTenant, name: string, environment: string): Promise<string> => {
    const row = { tenant_id: tenant.id, provider: 'aws', account_id: `5000${name}` };
    const created = await context.owner
      .insertInto('environments')
      .values(newEnvironment(tenant.id, environment))
      .onConflict((conflict) => conflict.columns(['tenant_id', 'name']).doUpdateSet({ name: environment }))
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        ...row,
        name,
        regions: ['eu-central-1'],
        status: 'connected',
        encrypted_credentials: context.app.get(CredentialVault).seal(row, TEST_ROLE),
        credential_hint: null,
        can_write: false,
        last_error: null,
        last_synced_at: null,
        environment_id: created.id,
        costs_checked_at: null,
        costs_updated_at: null,
        costs_error: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.owner
      .insertInto('resources')
      .values({
        tenant_id: tenant.id,
        cloud_account_id: id,
        region: 'eu-central-1',
        type: 'ecs-service',
        service: 'ecs',
        native_id: SERVICE,
        name: 'api',
        status: '2/2 tasks',
        health: 'healthy',
        tags: JSON.stringify({}),
        details: JSON.stringify({ cluster: 'main', launchType: 'FARGATE' }),
        last_seen_at: new Date(),
      })
      .execute();
    return id;
  };

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder
        .overrideProvider(GIT_PROVIDER_LIST)
        .useValue([git])
        .overrideProvider(CLOUD_PROVIDER_LIST)
        .useValue([cloud]),
    );
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    other = await signIn(context, context.globex, user('gia', 'admin'));
    const { body } = await http()
      .post('/api/git/connections')
      .set('Cookie', admin)
      .send({ provider: 'github', name: 'Org', organization: 'acme-org', credentials: { token: 'x' } })
      .expect(201);
    ({ id: appId } = await context.owner
      .insertInto('pipeline_apps')
      .values({
        tenant_id: context.acme.tenant.id,
        name: 'api',
        repository: REPOSITORY,
        connection_id: body.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow());
    stagingAccount = await addAccount(context.acme, 'staging', 'Staging');
    productionAccount = await addAccount(context.acme, 'production', 'Production');
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    await context.app.get<Redis>(REDIS).flushdb();
    await context.owner.deleteFrom('release_targets').execute();
    read.mockReset();
    read.mockResolvedValue(rollout);
  });

  it('follows a pipeline into its rollout', async () => {
    await link(target(stagingAccount)).expect(204);
    const { configured, releases } = await overview();

    expect(configured).toBe(true);
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({
      appName: 'api',
      pipelineName: 'Deploy',
      serviceName: 'api',
      environmentName: 'Staging',
      state: 'deploying',
      matchedBy: 'commit',
      issue: null,
    });
    expect(releases[0]!.servicePath).toMatch(/^\/infrastructure\/ecs\//);
    expect(releases[0]!.stages.map(({ label, status }) => [label, status])).toEqual([
      ['Build', 'success'],
      ['Test', 'success'],
      ['ECS Fargate', 'running'],
      ['Ready', 'waiting'],
    ]);
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: TEST_SESSION, region: 'eu-central-1' }),
    );
  });

  it('says when something is ready for testing', async () => {
    const finishedAt = new Date().toISOString();
    read.mockResolvedValue({ ...rollout, state: 'succeeded', runningTasks: 2, finishedAt });
    await link(target(stagingAccount)).expect(204);
    expect((await overview()).releases[0]).toMatchObject({ state: 'ready', readyAt: finishedAt });
  });

  it("offers the environment's app links, not Grafana", async () => {
    const { environment_id: environmentId } = await context.owner
      .selectFrom('cloud_accounts')
      .select('environment_id')
      .where('id', '=', stagingAccount)
      .executeTakeFirstOrThrow();
    const addDomain = (body: object) =>
      http().post(`/api/environments/${environmentId}/domains`).set('Cookie', admin).send(body).expect(201);
    await addDomain({ kind: 'grafana', url: 'grafana.staging.example.com' });
    await addDomain({ kind: 'app', label: 'Website', url: 'staging.example.com' });
    await link(target(stagingAccount)).expect(204);

    const [release] = (await overview()).releases;
    expect(release!.appDomains).toEqual([
      { id: expect.any(String), kind: 'app', label: 'Website', url: 'https://staging.example.com' },
    ]);
    await context.owner.deleteFrom('environment_domains').execute();
  });

  it('lets everyone see releases, but only some people link them', async () => {
    await link(target(stagingAccount), viewer).expect(403);
    await link(target(stagingAccount)).expect(204);
    expect((await overview(viewer)).releases).toHaveLength(1);
    await choices(stagingAccount, viewer).expect(403);
    const { id } = await context.owner.selectFrom('release_targets').select('id').executeTakeFirstOrThrow();
    await http().delete(`/api/releases/targets/${id}`).set('Cookie', viewer).expect(403);
    await http().delete(`/api/releases/targets/${id}`).set('Cookie', admin).expect(204);
    expect((await overview()).releases).toEqual([]);
  });

  it("offers only the account's own services, production included", async () => {
    const staging = (await choices(stagingAccount).expect(200)) as { body: ReleaseChoices };
    expect(staging.body.pipelines).toEqual([{ appId, workflowId: 'deploy', label: 'api: Deploy' }]);
    expect(staging.body.services).toEqual([
      { accountId: stagingAccount, nativeId: SERVICE, label: 'api', description: 'Staging · main' },
    ]);
    const production = (await choices(productionAccount).expect(200)) as { body: ReleaseChoices };
    expect(production.body.services).toEqual([
      { accountId: productionAccount, nativeId: SERVICE, label: 'api', description: 'Production · main' },
    ]);
  });

  it('shows a link only on the account of its service', async () => {
    await link(target(productionAccount)).expect(204);
    expect((await overview(admin, productionAccount)).releases).toMatchObject([{ environmentName: 'Production' }]);
    expect((await overview(admin, stagingAccount)).releases).toEqual([]);

    await link(target(stagingAccount)).expect(204);
    expect((await overview(admin, stagingAccount)).releases).toMatchObject([{ environmentName: 'Staging' }]);
    expect((await overview(admin, productionAccount)).releases).toHaveLength(1);
  });

  it('refuses a service that runs in another account', async () => {
    await context.owner
      .updateTable('resources')
      .set({ native_id: 'arn:production-only' })
      .where('cloud_account_id', '=', productionAccount)
      .execute();
    const { body } = await link(target(stagingAccount, 'arn:production-only')).expect(404);
    expect(body.message).toBe("That service isn't in this account.");
    await context.owner
      .updateTable('resources')
      .set({ native_id: SERVICE })
      .where('cloud_account_id', '=', productionAccount)
      .execute();
  });

  it('asks which account to show', async () => {
    const { body } = await http().get('/api/releases').set('Cookie', admin).expect(400);
    expect(body.message).toBe('Choose an account to see its releases.');
  });

  it('refuses a duplicate link and a pipeline that does not exist', async () => {
    await link(target(stagingAccount)).expect(204);
    await link(target(stagingAccount)).expect(409);
    await link({ ...target(stagingAccount), workflowId: 'other' }).expect(404);
  });

  it('shows a readable message when the rollout cannot be read', async () => {
    await link(target(stagingAccount)).expect(204);
    read.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'AccessDeniedException' }));
    const body = await overview();
    expect(body.releases[0]!.issue).toContain("doesn't have permission");
    expect(JSON.stringify(body)).not.toContain('raw aws text');
  });

  it('says so when a linked service has gone', async () => {
    await link(target(stagingAccount)).expect(204);
    await context.owner
      .updateTable('release_targets')
      .set({ native_id: 'arn:gone' })
      .execute();
    expect((await overview()).releases[0]!.issue).toContain("can't find this service");
  });

  it('caches rollouts so refreshing the page stays cheap', async () => {
    await link(target(stagingAccount)).expect(204);
    await overview();
    await overview();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('stays inside the workspace', async () => {
    await link(target(stagingAccount)).expect(204);
    await list(stagingAccount, other).expect(404);
    await link(target(stagingAccount), other).expect(404);
  });
});
