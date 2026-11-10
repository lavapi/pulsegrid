import { type ActionRun, type CloudPermission, productionPermission, type ResourceType, type UserPermission } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionQueue } from '../src/inventory/actions/action-queue';
import { ActionTracker } from '../src/inventory/actions/action-tracker';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import {
  CLOUD_PROVIDER_LIST,
  type ActionProgress,
  type ActionStart,
  type ActionTrackingContext,
  type CloudProvider,
  type ResourceActionContext,
} from '../src/inventory/providers/provider';
import { SyncQueue } from '../src/inventory/sync/sync-queue';
import {
  setExtraPermissions,
  signIn,
  startTestApp,
  type TestContext,
  type TestRole,
  user,
} from './support/test-app';
import { newEnvironment } from '../src/inventory/environments/account-environment';

const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'never-shown' };
const run = vi.fn<(context: ResourceActionContext) => Promise<ActionStart>>();
const track = vi.fn<(context: ActionTrackingContext) => Promise<ActionProgress>>();
const action = (permission: CloudPermission, resourceType: ResourceType) => ({
  permission,
  resourceType,
  timeoutMinutes: 10,
  run,
  track,
});

const provider: CloudProvider = {
  ...awsProvider,
  actions: [
    action('service.redeploy', 'ecs-service'),
    action('database.reboot', 'rds-instance'),
    action('cache.reboot', 'elasticache-cluster'),
    action('server.reboot', 'ec2-instance'),
  ],
};

describe('resource actions', () => {
  let context: TestContext;
  let owner: string;
  let admin: string;
  let developer: string;
  let otherOwner: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());

  const addAccount = async (environment: string | null, sealed = true) => {
    const tenantId = context.acme.tenant.id;
    sequence += 1;
    const accountId = String(100000000000 + sequence);
    const row = { tenant_id: tenantId, provider: 'aws', account_id: accountId };
    const environmentRow = environment
      ? await context.owner
          .insertInto('environments')
          .values(newEnvironment(tenantId, `${environment} ${sequence}`))
          .returning('id')
          .executeTakeFirstOrThrow()
      : null;
    const { id } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        ...row,
        name: 'Account',
        regions: ['eu-central-1'],
        encrypted_credentials: sealed ? context.app.get(CredentialVault).seal(row, KEY) : null,
        credential_hint: null,
        can_write: false,
        last_error: null,
        last_synced_at: null,
        environment_id: environmentRow?.id ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const addResource = async (cloudAccountId: string, type: ResourceType, name = 'api') => {
    const { id } = await context.owner
      .insertInto('resources')
      .values({
        tenant_id: context.acme.tenant.id,
        cloud_account_id: cloudAccountId,
        region: 'eu-central-1',
        type,
        service: 'ecs',
        native_id: `native-${name}-${(sequence += 1)}`,
        name,
        status: 'ok',
        health: 'healthy',
        tags: '{}',
        details: JSON.stringify({ cluster: 'main' }),
        last_seen_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const list = (id: string, cookie = owner) => http().get(`/api/resources/${id}/actions`).set('Cookie', cookie);
  const perform = (id: string, permission: string, cookie = owner) =>
    http().post(`/api/resources/${id}/actions/${permission}`).set('Cookie', cookie).send();
  const grant = (role: TestRole, permissions: UserPermission[]) =>
    setExtraPermissions(context, context.acme, role, permissions);
  const auditActions = (targetId: string) =>
    context.owner
      .selectFrom('audit_events')
      .select(['action', 'metadata'])
      .where('target_id', '=', targetId)
      .execute();

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]),
    );
    owner = await signIn(context, context.acme, user('ada', 'admin'));
    admin = await signIn(context, context.acme, user('second', 'admin'));
    developer = await signIn(context, context.acme, user('dev', 'developer'));
    otherOwner = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    run.mockReset();
    run.mockResolvedValue({ trackingId: 'deployment-1', summary: 'Starting' });
    track.mockReset();
    await grant('developer', []);
    await grant('admin', []);
  });

  describe('who can act', () => {
    it('gives people only the actions they were granted', async () => {
      const id = await addResource(await addAccount('Staging'), 'ec2-instance');
      expect((await list(id, developer).expect(200)).body).toEqual([]);
      await grant('developer', ['server.reboot']);
      expect((await list(id, developer).expect(200)).body).toEqual([
        { permission: 'server.reboot', blockedReason: null },
      ]);
      await perform(id, 'server.reboot', developer).expect(201);
      expect(run).toHaveBeenCalledTimes(1);
    });

    it('gives the owner every action, without a grant', async () => {
      const id = await addResource(await addAccount('Staging'), 'ec2-instance');
      expect((await list(id).expect(200)).body).toHaveLength(1);
      await perform(id, 'server.reboot').expect(201);
    });

    it('does not give Admins actions by role, and records the refusal', async () => {
      const id = await addResource(await addAccount('Staging'), 'ec2-instance');
      await perform(id, 'server.reboot', admin).expect(403);
      expect(run).not.toHaveBeenCalled();
      await grant('admin', ['server.reboot']);
      await perform(id, 'server.reboot', admin).expect(201);
      const events = await auditActions(id);
      expect(events.map(({ action: name }) => name)).toEqual(['access.denied', 'cloud.action.started']);
    });

    it('offers only actions that fit the resource', async () => {
      const id = await addResource(await addAccount('Staging'), 'ecs-service');
      expect((await list(id).expect(200)).body.map(({ permission }: { permission: string }) => permission)).toEqual([
        'service.redeploy',
      ]);
      await perform(id, 'server.reboot').expect(403);
      const bucket = await addResource(await addAccount('Staging'), 's3-bucket');
      expect((await list(bucket).expect(200)).body).toEqual([]);
      expect(run).not.toHaveBeenCalled();
    });

    it('rejects unknown actions and other workspaces', async () => {
      const id = await addResource(await addAccount('Staging'), 'ec2-instance');
      await perform(id, 'constructor').expect(404);
      await perform(id, 'nothing').expect(404);
      await perform(id, 'server.reboot', otherOwner).expect(404);
      await list(id, otherOwner).expect(404);
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe('safety', () => {
    it.each([
      ['ecs-service', 'service.redeploy'],
      ['rds-instance', 'database.reboot'],
      ['elasticache-cluster', 'cache.reboot'],
      ['ec2-instance', 'server.reboot'],
    ] as const)('runs %s %s in production only with the production permission', async (type, permission) => {
      const id = await addResource(await addAccount('Production'), type);
      await grant('developer', [permission]);
      const reason = expect.stringMatching(/^Ask your super admin for the .* production .* permission\.$/);
      expect((await list(id, developer).expect(200)).body[0].blockedReason).toEqual(reason);
      const response = await perform(id, permission, developer);
      expect(response.status).toBe(403);
      expect(response.body.message).toEqual(reason);
      expect(run).not.toHaveBeenCalled();
      expect((await auditActions(id)).map(({ action: name }) => name)).toEqual(['access.denied']);
      await grant('developer', [productionPermission(permission)]);
      await perform(id, permission, developer).expect(201);
    });

    it('does not let a production permission act on staging', async () => {
      const id = await addResource(await addAccount('Staging'), 'ec2-instance');
      await grant('developer', ['production.server.reboot']);
      await perform(id, 'server.reboot', developer).expect(403);
      expect(run).not.toHaveBeenCalled();
    });

    it('gives the owner production actions too', async () => {
      const id = await addResource(await addAccount('Production'), 'ec2-instance');
      await perform(id, 'server.reboot').expect(201);
    });

    it('refuses an account without an environment', async () => {
      const id = await addResource(await addAccount(null), 'ec2-instance');
      const response = await perform(id, 'server.reboot');
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Assign this account to an environment first.');
      expect(run).not.toHaveBeenCalled();
    });

    it('reboots a staging database', async () => {
      const id = await addResource(await addAccount('Staging'), 'rds-instance');
      await perform(id, 'database.reboot').expect(201);
    });

    it('needs an access key', async () => {
      const id = await addResource(await addAccount('Staging', false), 'ec2-instance');
      const response = await perform(id, 'server.reboot');
      expect(response.status).toBe(409);
      expect(response.body.message).toContain('no access key');
    });
  });

  describe('running', () => {
    it('passes the decrypted key and the resource to the provider', async () => {
      const id = await addResource(await addAccount('Staging'), 'ecs-service', 'web');
      await perform(id, 'service.redeploy').expect(201);
      expect(run).toHaveBeenCalledWith({
        credentials: KEY,
        region: 'eu-central-1',
        resource: { nativeId: expect.stringContaining('native-web'), name: 'web', details: { cluster: 'main' } },
      });
    });

    it('records success without any credentials', async () => {
      const id = await addResource(await addAccount('Staging'), 'ec2-instance', 'box');
      await perform(id, 'server.reboot').expect(201);
      const [event] = await auditActions(id);
      expect(event?.action).toBe('cloud.action.started');
      expect(event?.metadata).toMatchObject({ label: 'box', permission: 'server.reboot' });
      expect(JSON.stringify(event)).not.toContain(KEY.secretAccessKey);
    });

    it('shows a readable message when the key is not allowed, and records the failure', async () => {
      run.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'AccessDenied' }));
      const id = await addResource(await addAccount('Staging'), 'ec2-instance');
      const response = await perform(id, 'server.reboot');
      expect(response.status).toBe(400);
      expect(response.body.message).toBe("This key doesn't allow that. Add the action permissions to its IAM policy.");
      expect(JSON.stringify(response.body)).not.toContain('raw aws text');
      expect((await auditActions(id)).map(({ action: name }) => name)).toEqual(['cloud.action.failed']);
    });

    it('reboots a staging cache', async () => {
      const id = await addResource(await addAccount('Staging'), 'elasticache-cluster');
      await perform(id, 'cache.reboot').expect(201);
      expect(run).toHaveBeenCalledTimes(1);
    });
  });

  describe('progress', () => {
    const start = async (type: ResourceType = 'ec2-instance', permission = 'server.reboot') => {
      const id = await addResource(await addAccount('Staging'), type);
      const { body } = await perform(id, permission).expect(201);
      return { id, runId: (body as ActionRun).id };
    };
    const check = (runId: string) =>
      context.app.get(ActionTracker).check({ tenantId: context.acme.tenant.id, runId });
    const latest = async (id: string, cookie = owner) =>
      (await http().get(`/api/resources/${id}/actions/runs/latest`).set('Cookie', cookie).expect(200)).body as ActionRun;

    it('shows a run straight away, to anyone who can view the resource', async () => {
      const { id } = await start();
      expect(await latest(id, developer)).toMatchObject({
        title: 'Reboot server',
        status: 'running',
        summary: 'Starting',
        startedBy: 'ada@example.test',
        finishedAt: null,
      });
    });

    it('blocks a second action until the first has finished', async () => {
      const { id, runId } = await start();
      const second = await perform(id, 'server.reboot');
      expect(second.status).toBe(409);
      expect(second.body.message).toBe('Another action is still running on this resource.');
      expect(run).toHaveBeenCalledTimes(1);
      track.mockResolvedValue({ state: 'succeeded', summary: 'Ready' });
      await check(runId);
      await perform(id, 'server.reboot').expect(201);
    });

    it('does not block anything after an action fails to start', async () => {
      run.mockRejectedValueOnce(Object.assign(new Error('raw'), { name: 'AccessDenied' }));
      const id = await addResource(await addAccount('Staging'), 'ec2-instance');
      await perform(id, 'server.reboot').expect(400);
      expect(await latest(id)).toMatchObject({ status: 'failed' });
      await perform(id, 'server.reboot').expect(201);
    });

    it('updates the summary and keeps checking while it runs', async () => {
      const { id, runId } = await start('ecs-service', 'service.redeploy');
      const schedule = vi.spyOn(context.app.get(ActionQueue), 'scheduleCheck');
      track.mockResolvedValue({ state: 'running', summary: '1 of 2 new tasks running' });
      await check(runId);
      expect(track.mock.calls[0]?.[0]).toMatchObject({ trackingId: 'deployment-1' });
      expect(await latest(id)).toMatchObject({ status: 'running', summary: '1 of 2 new tasks running' });
      expect(schedule).toHaveBeenCalledWith({ tenantId: context.acme.tenant.id, runId });
      schedule.mockRestore();
    });

    it('records the result against the person who started it, and refreshes the account', async () => {
      const { id, runId } = await start();
      const sync = vi.spyOn(context.app.get(SyncQueue), 'enqueue');
      track.mockResolvedValue({ state: 'succeeded', summary: 'Ready' });
      await check(runId);
      expect(await latest(id)).toMatchObject({ status: 'succeeded', summary: 'Ready', finishedAt: expect.any(String) });
      const finished = await context.owner
        .selectFrom('audit_events')
        .selectAll()
        .where('target_id', '=', id)
        .where('action', '=', 'cloud.action.completed')
        .executeTakeFirstOrThrow();
      expect(finished.actor_email).toBe('ada@example.test');
      expect(finished.metadata).toMatchObject({ label: 'api', permission: 'server.reboot' });
      expect(sync).toHaveBeenCalledTimes(1);
      sync.mockRestore();
    });

    it.each([
      ['failed', 'cloud.action.failed'],
      ['unconfirmed', 'cloud.action.unconfirmed'],
    ] as const)('records a %s result', async (state, event) => {
      const { id, runId } = await start();
      track.mockResolvedValue({ state, summary: 'Result' });
      await check(runId);
      expect(await latest(id)).toMatchObject({ status: state });
      expect((await auditActions(id)).map(({ action: name }) => name)).toContain(event);
    });

    it('keeps going through a passing AWS error', async () => {
      const { id, runId } = await start();
      const schedule = vi.spyOn(context.app.get(ActionQueue), 'scheduleCheck');
      track.mockRejectedValue(new Error('throttled'));
      await check(runId);
      expect(await latest(id)).toMatchObject({ status: 'running' });
      expect(schedule).toHaveBeenCalledTimes(1);
      schedule.mockRestore();
    });

    it('times out, and frees the resource, even without the worker', async () => {
      const { id, runId } = await start();
      await context.owner
        .updateTable('action_runs')
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where('id', '=', runId)
        .execute();
      expect(await latest(id)).toMatchObject({
        status: 'timed_out',
        summary: 'Timed out. Check this in AWS, because it may still be running.',
      });
      await perform(id, 'server.reboot').expect(201);
    });

    it('stops checking a run that has finished', async () => {
      const { runId } = await start();
      track.mockResolvedValue({ state: 'succeeded', summary: 'Ready' });
      await check(runId);
      await check(runId);
      expect(track).toHaveBeenCalledTimes(1);
    });

    it('hides old results', async () => {
      const { id, runId } = await start();
      track.mockResolvedValue({ state: 'succeeded', summary: 'Ready' });
      await check(runId);
      await context.owner
        .updateTable('action_runs')
        .set({ finished_at: new Date(Date.now() - 2 * 60 * 60 * 1000) })
        .where('id', '=', runId)
        .execute();
      const response = await http().get(`/api/resources/${id}/actions/runs/latest`).set('Cookie', owner).expect(200);
      expect(response.text).toBe('');
    });

    it('keeps runs inside their workspace', async () => {
      const { id } = await start();
      const response = await http().get(`/api/resources/${id}/actions/runs/latest`).set('Cookie', otherOwner).expect(200);
      expect(response.text).toBe('');
    });
  });
});
