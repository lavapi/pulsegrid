import type { ActionRun, ResourceType } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityWatcher } from '../src/inventory/actions/activity-watcher';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import {
  type ActionStart,
  CLOUD_PROVIDER_LIST,
  type CloudProvider,
  type DetectedActivity,
} from '../src/inventory/providers/provider';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';
import { newEnvironment } from '../src/inventory/environments/account-environment';

const detect = vi.fn<() => Promise<DetectedActivity[]>>();
const run = vi.fn<() => Promise<ActionStart>>();

const provider: CloudProvider = {
  ...awsProvider,
  actions: [
    {
      permission: 'service.redeploy',
      resourceType: 'ecs-service',
      timeoutMinutes: 10,
      run,
      track: async () => ({ state: 'running', summary: 'Tracked' }),
    },
  ],
  activityWatches: [{ types: ['ecs-service'], detect }],
};

const seen = (nativeId: string, summary = '1 of 2 new tasks running', failed = false): DetectedActivity => ({
  resourceType: 'ecs-service',
  nativeId,
  title: 'Deployment',
  summary,
  failed,
});

describe('outside activity', () => {
  let context: TestContext;
  let owner: string;
  let viewer: string;
  let otherOwner: string;
  let accountId: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());
  const watch = () =>
    context.app.get(ActivityWatcher).watch({ tenantId: context.acme.tenant.id, accountId });

  const addAccount = async () => {
    const tenantId = context.acme.tenant.id;
    sequence += 1;
    const row = { tenant_id: tenantId, provider: 'aws', account_id: String(200000000000 + sequence) };
    const environment = await context.owner
      .insertInto('environments')
      .values(newEnvironment(tenantId, `Staging ${sequence}`))
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        ...row,
        name: 'Account',
        regions: ['eu-central-1'],
        encrypted_credentials: context.app.get(CredentialVault).seal(row, { accessKeyId: 'a', secretAccessKey: 'b' }),
        credential_hint: null,
        can_write: false,
        last_error: null,
        last_synced_at: null,
        environment_id: environment.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const addResource = async (name: string, type: ResourceType = 'ecs-service') => {
    const { id } = await context.owner
      .insertInto('resources')
      .values({
        tenant_id: context.acme.tenant.id,
        cloud_account_id: accountId,
        region: 'eu-central-1',
        type,
        service: 'ecs',
        native_id: name,
        name,
        status: 'ok',
        health: 'healthy',
        tags: '{}',
        details: '{}',
        last_seen_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const activity = async (cookie = owner) =>
    (await http().get(`/api/resource-activity?account=${accountId}`).set('Cookie', cookie).expect(200))
      .body as ActionRun[];
  const auditFor = (id: string) =>
    context.owner
      .selectFrom('audit_events')
      .select(['action', 'actor_email'])
      .where('target_id', '=', id)
      .execute();

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]),
    );
    owner = await signIn(context, context.acme, user('ada', 'admin'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    otherOwner = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    detect.mockReset();
    detect.mockResolvedValue([]);
    run.mockReset();
    run.mockResolvedValue({ trackingId: null, summary: 'Starting' });
    accountId = await addAccount();
  });

  it('shows work started outside the dashboard', async () => {
    const id = await addResource('web');
    detect.mockResolvedValue([seen('web')]);
    await watch();
    expect(await activity(viewer)).toMatchObject([
      {
        resourceId: id,
        title: 'Deployment',
        status: 'running',
        summary: '1 of 2 new tasks running',
        startedBy: null,
      },
    ]);
    expect(await auditFor(id)).toEqual([{ action: 'cloud.activity.detected', actor_email: null }]);
  });

  it('updates the same record while the work carries on', async () => {
    await addResource('web');
    detect.mockResolvedValue([seen('web')]);
    await watch();
    detect.mockResolvedValue([seen('web', '2 of 2 new tasks running')]);
    await watch();
    const runs = await activity();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.summary).toBe('2 of 2 new tasks running');
  });

  it('finishes when the work is no longer reported', async () => {
    const id = await addResource('web');
    detect.mockResolvedValue([seen('web')]);
    await watch();
    detect.mockResolvedValue([]);
    await watch();
    expect(await activity()).toMatchObject([{ status: 'succeeded', finishedAt: expect.any(String) }]);
    expect((await auditFor(id)).map(({ action }) => action)).toEqual([
      'cloud.activity.detected',
      'cloud.activity.succeeded',
    ]);
  });

  it('reports a failure on work it was following', async () => {
    await addResource('web');
    detect.mockResolvedValue([seen('web')]);
    await watch();
    detect.mockResolvedValue([seen('web', 'The deployment failed.', true)]);
    await watch();
    expect(await activity()).toMatchObject([{ status: 'failed', summary: 'The deployment failed.' }]);
  });

  it('does not bring up an old failure it never saw running', async () => {
    await addResource('web');
    detect.mockResolvedValue([seen('web', 'The deployment failed.', true)]);
    await watch();
    expect(await activity()).toEqual([]);
  });

  it('leaves actions started in the dashboard to their own tracking', async () => {
    const id = await addResource('web');
    await http().post(`/api/resources/${id}/actions/service.redeploy`).set('Cookie', owner).send({}).expect(201);
    detect.mockResolvedValue([seen('web', 'Seen by the watcher')]);
    await watch();
    detect.mockResolvedValue([]);
    await watch();
    expect(await activity()).toMatchObject([{ status: 'running', summary: 'Starting', startedBy: 'ada@example.test' }]);
  });

  it('blocks actions while outside work is running', async () => {
    const id = await addResource('web');
    detect.mockResolvedValue([seen('web')]);
    await watch();
    const response = await http().post(`/api/resources/${id}/actions/service.redeploy`).set('Cookie', owner).send({});
    expect(response.status).toBe(409);
    expect(run).not.toHaveBeenCalled();
    detect.mockResolvedValue([]);
    await watch();
    await http().post(`/api/resources/${id}/actions/service.redeploy`).set('Cookie', owner).send({}).expect(201);
  });

  it('ignores resources the dashboard does not know yet', async () => {
    await addResource('web');
    detect.mockResolvedValue([seen('unknown')]);
    await watch();
    expect(await activity()).toEqual([]);
  });

  it('leaves running work alone, and pauses, when AWS fails', async () => {
    await addResource('web');
    detect.mockResolvedValue([seen('web')]);
    await watch();
    detect.mockRejectedValue(Object.assign(new Error('raw'), { name: 'ThrottlingException' }));
    await watch();
    expect(await activity()).toMatchObject([{ status: 'running' }]);
    detect.mockClear();
    await watch();
    expect(detect).not.toHaveBeenCalled();
  });

  it('stops showing work as running when reports stop', async () => {
    await addResource('web');
    detect.mockResolvedValue([seen('web')]);
    await watch();
    await context.owner
      .updateTable('action_runs')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('status', '=', 'running')
      .execute();
    expect(await activity()).toMatchObject([{ status: 'timed_out' }]);
  });

  it('shows one result for each resource', async () => {
    await addResource('web');
    detect.mockResolvedValue([seen('web')]);
    await watch();
    detect.mockResolvedValue([]);
    await watch();
    detect.mockResolvedValue([seen('web', 'Again')]);
    await watch();
    expect(await activity()).toMatchObject([{ status: 'running', summary: 'Again' }]);
  });

  it('keeps activity inside its workspace', async () => {
    await addResource('web');
    detect.mockResolvedValue([seen('web')]);
    await watch();
    expect(await activity(otherOwner)).toEqual([]);
  });

  it('skips an account whose key cannot be opened, without failing', async () => {
    await context.owner
      .updateTable('cloud_accounts')
      .set({ encrypted_credentials: 'not-encrypted' })
      .where('id', '=', accountId)
      .execute();
    await expect(watch()).resolves.toBeUndefined();
    expect(detect).not.toHaveBeenCalled();
  });

  it('skips accounts without a key', async () => {
    await context.owner
      .updateTable('cloud_accounts')
      .set({ encrypted_credentials: null })
      .where('id', '=', accountId)
      .execute();
    await watch();
    expect(detect).not.toHaveBeenCalled();
  });
});
