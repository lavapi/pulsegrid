import type { PipelineRun } from '@pulsegrid/shared';
import type { Kysely } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATABASE } from '../src/database/database.module';
import type { Database } from '../src/database/schema';
import { TenantDatabase } from '../src/database/tenant-database';
import { ServiceHealthAlerts } from '../src/inventory/health/service-health-alerts';
import { newEnvironment } from '../src/inventory/environments/account-environment';
import type { GitClient } from '../src/pipelines/git/git-provider';
import { PipelineRunAlerts } from '../src/pipelines/pipeline-run-alerts';
import type { GitConnectionsService } from '../src/pipelines/git/git-connections.service';
import { PUSH_SENDER, PushNotifier } from '../src/push/push-notifier';
import { REDIS } from '../src/redis/redis.module';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

const sender = { send: vi.fn(async () => 'sent' as const) };

describe('notifications', () => {
  let context: TestContext;
  let ada: string;
  const http = () => request(context.app.getHttpServer());
  const tenantId = () => context.acme.tenant.id;
  const accountOf = (email: string) =>
    context.owner.selectFrom('accounts').select('id').where('email', '=', email).executeTakeFirstOrThrow();

  const phoneOf = async (email: string, apnsToken: string) => {
    const account = await accountOf(email);
    const session = await context.owner
      .insertInto('sessions')
      .values({ account_id: account.id, tenant_id: tenantId(), token_hash: apnsToken, expires_at: new Date(Date.now() + 3_600_000), client: 'ios' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await context.owner
      .insertInto('push_devices')
      .values({ account_id: account.id, session_id: session.id, apns_token: apnsToken, environment: 'sandbox' })
      .execute();
  };

  beforeAll(async () => {
    context = await startTestApp((builder) => builder.overrideProvider(PUSH_SENDER).useValue(sender));
    ada = await signIn(context, context.acme, user('ada', 'admin'));
    await signIn(context, context.acme, user('val', 'viewer'));
    await phoneOf('ada@example.test', 'a'.repeat(64));
    await phoneOf('val@example.test', 'b'.repeat(64));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    sender.send.mockClear();
    await context.owner.deleteFrom('notification_settings').execute();
  });

  describe('settings', () => {
    it('starts from the defaults and keeps each change', async () => {
      const { body } = await http().get('/api/account/notifications').set('Cookie', ada).expect(200);
      expect(body).toEqual({
        database_access: true,
        production_releases: true,
        unhealthy_production: true,
        unhealthy_staging: false,
        failed_pipelines: true,
        failover_tests: true,
      });
      const changed = await http().put('/api/account/notifications').set('Cookie', ada).send({ unhealthy_staging: true, failed_pipelines: false }).expect(200);
      expect(changed.body).toMatchObject({ unhealthy_staging: true, failed_pipelines: false, database_access: true });
      const again = await http().get('/api/account/notifications').set('Cookie', ada).expect(200);
      expect(again.body).toEqual(changed.body);
    });

    it('turns down unknown topics and non-yes/no values, and needs a sign-in', async () => {
      await http().put('/api/account/notifications').set('Cookie', ada).send({ everything: true }).expect(400);
      await http().put('/api/account/notifications').set('Cookie', ada).send({ failed_pipelines: 'yes' }).expect(400);
      await http().get('/api/account/notifications').expect(401);
    });

    it('sends only to people who left the topic on', async () => {
      const notifier = context.app.get(PushNotifier);
      await http().put('/api/account/notifications').set('Cookie', ada).send({ unhealthy_production: false }).expect(200);
      notifier.toProject(tenantId(), 'unhealthy_production', { title: 't', body: 'b', path: '/', collapseId: 'c' });
      await vi.waitFor(() => expect(sender.send).toHaveBeenCalledTimes(1));
      expect(sender.send).toHaveBeenCalledWith('b'.repeat(64), 'sandbox', expect.anything());
    });
  });

  describe('unhealthy services', () => {
    const push = { toProject: vi.fn() };
    let alerts: ServiceHealthAlerts;
    let production: string;
    let staging: string;

    const addAccount = async (name: string, isProduction: boolean, sequence: number) => {
      const environment = await context.owner
        .insertInto('environments')
        .values({ ...newEnvironment(tenantId(), name, sequence), is_production: isProduction })
        .returning('id')
        .executeTakeFirstOrThrow();
      const account = await context.owner
        .insertInto('cloud_accounts')
        .values({ tenant_id: tenantId(), provider: 'aws', account_id: String(700000000000 + sequence), name, regions: ['eu-central-1'], environment_id: environment.id })
        .returning('id')
        .executeTakeFirstOrThrow();
      return account.id;
    };
    const addService = async (accountId: string, name: string) =>
      (
        await context.owner
          .insertInto('resources')
          .values({ tenant_id: tenantId(), cloud_account_id: accountId, region: 'eu-central-1', type: 'ecs-service', service: 'ecs', native_id: `arn:${name}`, name, status: 'ACTIVE', health: 'healthy', tags: '{}', details: '{}', last_seen_at: new Date() })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    const setHealth = (id: string, health: 'healthy' | 'degraded') =>
      context.owner.updateTable('resources').set({ health }).where('id', '=', id).execute();

    beforeAll(async () => {
      alerts = new ServiceHealthAlerts(
        context.app.get<Kysely<Database>>(DATABASE),
        context.app.get(TenantDatabase),
        context.app.get(REDIS),
        push as unknown as PushNotifier,
      );
      production = await addAccount('production', true, 1);
      staging = await addAccount('staging', false, 2);
    });
    beforeEach(() => push.toProject.mockClear());

    it('announces a service once when it turns degraded, by environment', async () => {
      const api = await addService(production, 'api');
      const worker = await addService(staging, 'worker');
      await alerts.check();
      expect(push.toProject).not.toHaveBeenCalled();

      await setHealth(api, 'degraded');
      await setHealth(worker, 'degraded');
      await alerts.check();
      await alerts.check();
      expect(push.toProject).toHaveBeenCalledTimes(2);
      expect(push.toProject).toHaveBeenCalledWith(tenantId(), 'unhealthy_production', {
        title: 'api is degraded',
        body: 'ECS services · production · eu-central-1',
        path: `/infrastructure/${api}`,
        collapseId: `health-${api}`,
      });
      expect(push.toProject).toHaveBeenCalledWith(tenantId(), 'unhealthy_staging', expect.objectContaining({ title: 'worker is degraded' }));
    });

    it('stays quiet when a service flips back soon after recovering, and speaks again after a quiet spell', async () => {
      const cache = await addService(production, 'cache');
      await setHealth(cache, 'degraded');
      await alerts.check();
      await setHealth(cache, 'healthy');
      await alerts.check();
      await setHealth(cache, 'degraded');
      await alerts.check();
      expect(push.toProject.mock.calls.filter(([, , message]) => message.collapseId === `health-${cache}`)).toHaveLength(1);

      await context.app.get(REDIS).del(`service-health:quiet:${cache}`);
      await setHealth(cache, 'healthy');
      await alerts.check();
      await context.app.get(REDIS).del(`service-health:quiet:${cache}`);
      await setHealth(cache, 'degraded');
      await alerts.check();
      expect(push.toProject.mock.calls.filter(([, , message]) => message.collapseId === `health-${cache}`)).toHaveLength(2);
    });
  });

  describe('failed pipelines', () => {
    const push = { toUser: vi.fn() };
    const runs: Record<string, PipelineRun> = {};
    const client = {
      listRuns: vi.fn(async () => Object.values(runs)),
      getRun: vi.fn(async (_repository: string, id: string) => runs[id]!),
    };
    let alerts: PipelineRunAlerts;
    let appId: string;
    let userId: string;

    const run = (id: string, status: PipelineRun['status'], startedAt: Date, event = 'workflow_dispatch'): PipelineRun => ({
      id, workflowId: 'deploy.yml', workflowName: 'Deploy', repository: 'acme/api', number: 1, title: 'Fix login', branch: 'main',
      commit: 'abc1234', event, actor: 'bot', status, startedAt: startedAt.toISOString(), finishedAt: null, durationSeconds: null, url: 'https://github.com',
    });
    const watch = (runId: string | null, startedAt = new Date()) =>
      context.owner
        .insertInto('watched_pipeline_runs')
        .values({ tenant_id: tenantId(), user_id: userId, app_id: appId, workflow_id: 'deploy.yml', pipeline_name: 'Deploy', branch: 'main', run_id: runId, started_at: startedAt, expires_at: new Date(Date.now() + 3_600_000) })
        .returning('id')
        .executeTakeFirstOrThrow();
    const watching = () => context.owner.selectFrom('watched_pipeline_runs').select(['run_id']).execute();

    beforeAll(async () => {
      const connections = { clientFor: async () => client as unknown as GitClient } as unknown as GitConnectionsService;
      alerts = new PipelineRunAlerts(context.app.get<Kysely<Database>>(DATABASE), context.app.get(TenantDatabase), connections, push as unknown as PushNotifier);
      appId = (await context.owner.insertInto('pipeline_apps').values({ tenant_id: tenantId(), name: 'api', repository: 'acme/api', connection_id: null }).returning('id').executeTakeFirstOrThrow()).id;
      const connection = await context.owner
        .insertInto('git_connections')
        .values({ tenant_id: tenantId(), provider: 'github', name: 'Acme', organization: 'acme', encrypted_credentials: 'x', credential_hint: 'x' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await context.owner.updateTable('pipeline_apps').set({ connection_id: connection.id }).where('id', '=', appId).execute();
      userId = (await context.owner.selectFrom('users').select('id').where('email', '=', 'ada@example.test').executeTakeFirstOrThrow()).id;
    });
    beforeEach(async () => {
      push.toUser.mockClear();
      for (const id of Object.keys(runs)) delete runs[id];
      await context.owner.deleteFrom('watched_pipeline_runs').execute();
    });

    it('tells the person when a run they started fails, and then stops following it', async () => {
      runs['41'] = run('41', 'running', new Date());
      await watch('41');
      await alerts.check();
      expect(push.toUser).not.toHaveBeenCalled();
      runs['41'] = run('41', 'failure', new Date());
      await alerts.check();
      expect(push.toUser).toHaveBeenCalledWith(tenantId(), userId, 'failed_pipelines', {
        title: 'Deploy failed',
        body: 'main · abc1234 “Fix login”',
        path: `/pipelines/runs/${appId}/41`,
        collapseId: 'pipeline-41',
      });
      expect(await watching()).toHaveLength(0);
    });

    it('stays quiet about a run that passed, and about the old result of a run re-run just now', async () => {
      runs['42'] = run('42', 'success', new Date());
      runs['43'] = run('43', 'failure', new Date(Date.now() - 3_600_000));
      await watch('42');
      await watch('43');
      await alerts.check();
      expect(push.toUser).not.toHaveBeenCalled();
      expect((await watching()).map(({ run_id }) => run_id)).toEqual(['43']);
    });

    it('finds a run GitHub did not name: the first manual run on the branch since it was started', async () => {
      const startedAt = new Date();
      runs['50'] = run('50', 'failure', new Date(startedAt.getTime() - 600_000));
      runs['51'] = run('51', 'running', new Date(startedAt.getTime() + 5_000), 'push');
      runs['52'] = run('52', 'running', new Date(startedAt.getTime() + 8_000));
      await watch(null, startedAt);
      await alerts.check();
      expect((await watching()).map(({ run_id }) => run_id)).toEqual(['52']);
    });

    it('forgets runs it followed too long', async () => {
      await context.owner
        .insertInto('watched_pipeline_runs')
        .values({ tenant_id: tenantId(), user_id: userId, app_id: appId, workflow_id: 'deploy.yml', pipeline_name: 'Deploy', branch: 'main', run_id: '60', expires_at: new Date(Date.now() - 1000) })
        .execute();
      await alerts.check();
      expect(await watching()).toHaveLength(0);
      expect(client.getRun).not.toHaveBeenCalledWith('acme/api', '60');
    });
  });
});
