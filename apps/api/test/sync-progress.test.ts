import type { SyncProgress } from '@pulsegrid/shared';
import type Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SyncProgressStore } from '../src/inventory/sync/sync-progress.store';
import { REDIS } from '../src/redis/redis.module';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

describe('sync progress', () => {
  let context: TestContext;
  let admin: string;
  let colleague: string;
  let other: string;
  let accountId: string;

  const http = () => request(context.app.getHttpServer());
  const store = () => context.app.get(SyncProgressStore);
  const tenantId = () => context.acme.tenant.id;
  const target = () => ({ tenantId: tenantId(), accountId });
  const list = async (cookie: string): Promise<SyncProgress[]> =>
    (await http().get('/api/cloud/sync-progress').set('Cookie', cookie).expect(200)).body;

  beforeAll(async () => {
    context = await startTestApp();
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    colleague = await signIn(context, context.acme, user('bea', 'admin'));
    other = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());

  beforeEach(async () => {
    await context.app.get<Redis>(REDIS).flushdb();
    await context.owner.deleteFrom('cloud_accounts').execute();
    ({ id: accountId } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        tenant_id: tenantId(),
        account_id: '111111111111',
        name: 'Staging',
        regions: ['eu-central-1'],
        status: 'connected',
        provider: 'aws',
        encrypted_credentials: 'sealed',
      })
      .returning('id')
      .executeTakeFirstOrThrow());
  });

  it('keeps scheduled syncs out of view', async () => {
    const tracker = store().begin(target());
    await tracker.accounts([{ id: accountId, name: 'Staging' }]);
    expect(await list(admin)).toEqual([]);
  });

  it('shows a requested sync to the workspace, and not to other tenants', async () => {
    await http().post(`/api/cloud/accounts/${accountId}/sync`).set('Cookie', admin).expect(202);
    const [progress] = await list(colleague);
    expect(progress).toMatchObject({ accountId, phase: 'queued', percent: 0 });
    expect(await list(other)).toEqual([]);
  });

  it('follows the worker through to the finish', async () => {
        await store().watch(target());
    const tracker = store().begin(target());
    await tracker.accounts([{ id: accountId, name: 'Staging' }]);
    await tracker.accountStarted(accountId, 2);
    await tracker.taskFinished(accountId, 'ECS', { resources: 3 });
    expect((await list(admin))[0]).toMatchObject({ phase: 'reading', percent: 50 });
    await tracker.accountFinished(accountId);
    await tracker.finish();
    expect((await list(admin))[0]).toMatchObject({
      phase: 'finished',
      percent: 100,
      message: 'Sync finished: 3 resources in 1 account.',
    });
  });

  it('joins a sync that is already running', async () => {
        const tracker = store().begin(target());
    await tracker.accounts([{ id: accountId, name: 'Staging' }]);
    await store().watch(target());
    expect((await list(admin))[0]?.phase).toBe('reading');
  });

});
