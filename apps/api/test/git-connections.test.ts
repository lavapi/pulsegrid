import type Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GIT_PROVIDER_LIST,
  type GitClient,
  type GitProvider,
  GitProviderError,
} from '../src/pipelines/git/git-provider';
import { githubProvider } from '../src/pipelines/git/github/github.provider';
import { REDIS } from '../src/redis/redis.module';
import { signIn, startTestApp, type TestContext, user, } from './support/test-app';

const REPOSITORY = 'shared-org/deep/nested/repo';

const clientFor = (token: string): GitClient => ({
  checkAccess: async () => {
    if (token === 'bad') {
      throw new GitProviderError('That token was refused.');
    }
    return { account: 'bot', repositories: 1, canRun: null };
  },
  listRepositories: async () => {
    if (token === 'expired-token') {
      throw new GitProviderError('GitHub rejected the token.');
    }
    return [{ fullName: REPOSITORY }];
  },
  listWorkflows: async (repository) => [
    { id: '1', repository, name: `Pipeline for ${token}`, path: 'pipeline.yml', url: 'https://git.test' },
  ],
  listRuns: async () => [],
  getRun: async () => {
    throw new GitProviderError('Not found.');
  },
  listJobs: async () => [],
  getRepository: async () => ({ defaultBranch: 'main' }),
  listBranches: async () => ['main'],
  readDefinition: async () => null,
  startRun: async () => undefined,
  rerun: async () => undefined,
  cancel: async () => undefined,
});

const otherGit: GitProvider = {
  id: 'othergit',
  parseCredentials: (input) => {
    const { token } = input as { token?: string };
    return token ? { token } : null;
  },
  credentialHint: ({ token }) => `…${(token ?? '').slice(-2)}`,
  connect: ({ token }) => clientFor(token ?? ''),
};

describe('git connections', () => {
  let context: TestContext;
  let admin: string;
  let viewer: string;
  let other: string;

  const http = () => request(context.app.getHttpServer());
  const connection = (token = 'acme-secret-token') => ({
    provider: 'othergit',
    name: 'Shared',
    organization: 'shared-org',
    credentials: { token },
  });
  const connect = (cookie: string, body: object = connection()) =>
    http().post('/api/git/connections').set('Cookie', cookie).send(body);
  const createApp = (cookie: string, connectionId: string) =>
    http()
      .post('/api/pipelines/apps')
      .set('Cookie', cookie)
      .send({ name: 'Shop', connectionId, repository: REPOSITORY })
      .expect(201);

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder.overrideProvider(GIT_PROVIDER_LIST).useValue([githubProvider, otherGit]),
    );
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    other = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());

  beforeEach(async () => {
    await context.app.get<Redis>(REDIS).flushdb();
    await context.owner.deleteFrom('pipeline_apps').execute();
    await context.owner.deleteFrom('git_connections').execute();
  });

  it('only lets admins manage connections', async () => {
    await connect(viewer).expect(403);
    await http().get('/api/git/connections').set('Cookie', viewer).expect(403);
  });

  it('checks credentials before saving, with a friendly message', async () => {
    const check = await http()
      .post('/api/git/connections/check')
      .set('Cookie', admin)
      .send(connection())
      .expect(200);
    expect(check.body).toEqual({ account: 'bot', repositories: 1, canRun: null });
    const refused = await connect(admin, connection('bad'));
    expect(refused.status).toBe(400);
    expect(refused.body.message).toBe('That token was refused.');
  });

  it('never returns or stores the token in plain text', async () => {
    const { body } = await connect(admin).expect(201);
    expect(body.credentialHint).toBe('…en');
    const { text } = await http().get('/api/git/connections').set('Cookie', admin).expect(200);
    expect(text).not.toContain('acme-secret-token');
    const row = await context.owner
      .selectFrom('git_connections')
      .select('encrypted_credentials')
      .where('id', '=', body.id)
      .executeTakeFirstOrThrow();
    expect(row.encrypted_credentials).not.toContain('acme-secret-token');
    const audit = await http().get('/api/audit-events').set('Cookie', admin);
    expect(audit.text).not.toContain('acme-secret-token');
  });

  it('refuses a provider that does not exist, and a second connection to an organization', async () => {
    await connect(admin, { ...connection(), provider: 'nope' }).expect(400);
    await connect(admin).expect(201);
    const repeat = await connect(admin);
    expect(repeat.status).toBe(409);
    expect(repeat.body.message).toContain('already connected');
  });

  it('keeps two workspaces apart, even with the same repository name', async () => {
    const { body: ours } = await connect(admin).expect(201);
    const { body: theirs } = await connect(other, connection('globex-secret-token')).expect(201);
    const { body: ourApp } = await createApp(admin, ours.id);
    const { body: theirApp } = await createApp(other, theirs.id);

    const mine = await http().get(`/api/pipelines/apps/${ourApp.id}`).set('Cookie', admin).expect(200);
    const yours = await http().get(`/api/pipelines/apps/${theirApp.id}`).set('Cookie', other).expect(200);

    expect(mine.body.pipelines[0].name).toBe('Pipeline for acme-secret-token');
    expect(yours.body.pipelines[0].name).toBe('Pipeline for globex-secret-token');
  });

  it('supports nested repositories', async () => {
    const { body } = await connect(admin).expect(201);
    const { body: app } = await createApp(admin, body.id);
    expect(app.repository).toBe(REPOSITORY);
  });

  it('attaches existing apps when their organization connects', async () => {
    const { id } = await context.owner
      .insertInto('pipeline_apps')
      .values({ tenant_id: context.acme.tenant.id, name: 'Old', repository: 'Shared-Org/old' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { body } = await connect(admin).expect(201);
    const app = await http().get(`/api/pipelines/apps/${id}`).set('Cookie', admin).expect(200);
    expect(app.body.app.connectionId).toBe(body.id);
  });

  it('keeps apps when a connection is removed', async () => {
    const { body } = await connect(admin).expect(201);
    const { body: app } = await createApp(admin, body.id);
    await http().delete(`/api/git/connections/${body.id}`).set('Cookie', admin).expect(204);
    const detail = await http().get(`/api/pipelines/apps/${app.id}`).set('Cookie', admin).expect(200);
    expect(detail.body).toMatchObject({ app: { connectionId: null }, pipelines: [] });
    const run = await http().get(`/api/pipelines/run?app=${app.id}&run=1`).set('Cookie', admin);
    expect(run.status).toBe(409);
    expect(run.body.message).toContain('Git connection is missing');
  });

  it('keeps working when one connection is broken', async () => {
    await connect(admin, { ...connection('expired-token'), organization: 'old-org' }).expect(201);
    await context.owner
      .insertInto('git_connections')
      .values({
        tenant_id: context.acme.tenant.id,
        provider: 'othergit',
        name: 'Unreadable',
        organization: 'lost-org',
        encrypted_credentials: 'not-encrypted',
        credential_hint: '…xx',
      })
      .execute();
    await connect(admin).expect(201);
    const { body } = await http().get('/api/pipelines/apps/repositories').set('Cookie', admin).expect(200);
    expect(body.map(({ connectionName }: { connectionName: string }) => connectionName)).toEqual(['Shared']);
  });

  it('replaces credentials and tests a connection', async () => {
    const { body } = await connect(admin).expect(201);
    await http()
      .put(`/api/git/connections/${body.id}/credentials`)
      .set('Cookie', admin)
      .send({ credentials: { token: 'replaced-token-99' } })
      .expect(200);
    const tested = await http().post(`/api/git/connections/${body.id}/test`).set('Cookie', admin).expect(200);
    expect(tested.body).toMatchObject({ status: 'connected', credentialHint: '…99' });
  });
});
