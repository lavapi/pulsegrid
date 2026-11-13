import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newEnvironment } from '../src/inventory/environments/account-environment';
import { setExtraPermissions, signIn, startTestApp, type TestContext, user } from './support/test-app';

describe('display names', () => {
  let context: TestContext;
  let admin: string;
  let developer: string;
  let otherAdmin: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());
  const tenantId = () => context.acme.tenant.id;

  const addAccount = async () => {
    sequence += 1;
    const { id: environmentId } = await context.owner
      .insertInto('environments')
      .values(newEnvironment(tenantId(), 'Staging', sequence))
      .onConflict((conflict) => conflict.columns(['tenant_id', 'name']).doUpdateSet({ sort_order: sequence }))
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        tenant_id: tenantId(),
        provider: 'aws',
        account_id: String(700000000000 + sequence),
        name: 'Staging',
        regions: ['eu-central-1'],
        environment_id: environmentId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const addResource = async (accountId: string, type: string, name: string, nativeId = `arn:${type}:${name}`) => {
    const { id } = await context.owner
      .insertInto('resources')
      .values({
        tenant_id: tenantId(),
        cloud_account_id: accountId,
        region: 'eu-central-1',
        type: type as 'ecs-cluster',
        service: 'ecs',
        native_id: nativeId,
        name,
        status: 'ACTIVE',
        health: 'healthy',
        tags: '{}',
        details: '{}',
        last_seen_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const rename = (id: string, displayName: string, cookie = admin) =>
    http().put(`/api/resources/${id}/display-name`).set('Cookie', cookie).send({ displayName });
  const get = (id: string, cookie = admin) => http().get(`/api/resources/${id}`).set('Cookie', cookie);

  beforeAll(async () => {
    context = await startTestApp();
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    developer = await signIn(context, context.acme, user('dev', 'developer'));
    otherAdmin = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    await context.owner.deleteFrom('resource_display_names').execute();
    await setExtraPermissions(context, context.acme, 'developer', []);
  });

  it('shows a display name in place of the cloud name, keeping the cloud name beside it', async () => {
    const id = await addResource(await addAccount(), 'ecs-cluster', 'jack-mike-one');
    const { body } = await rename(id, '  Frontend  ').expect(200);
    expect(body).toMatchObject({ name: 'jack-mike-one', displayName: 'Frontend' });
    expect((await get(id).expect(200)).body).toMatchObject({ name: 'jack-mike-one', displayName: 'Frontend' });
  });

  it('works for ECS, EC2 and RDS, and refuses other types', async () => {
    const accountId = await addAccount();
    for (const type of ['ecs-service', 'ec2-instance', 'rds-cluster', 'rds-instance']) {
      await rename(await addResource(accountId, type, `${type}-1`), 'Renamed').expect(200);
    }
    const bucket = await addResource(accountId, 's3-bucket', 'logs');
    expect((await rename(bucket, 'Logs')).body.message).toBe("This kind of resource can't be given a display name.");
  });

  it('finds a resource by either name, and goes back to the cloud name when reset', async () => {
    const accountId = await addAccount();
    const id = await addResource(accountId, 'ecs-service', 'svc-a91f-prod');
    await rename(id, 'Payments API').expect(200);
    const search = async (q: string) =>
      (
        await http()
          .get(`/api/resources?account=${accountId}&q=${encodeURIComponent(q)}`)
          .set('Cookie', admin)
      ).body.resources.map(({ id: found }: { id: string }) => found);
    expect(await search('payments')).toEqual([id]);
    expect(await search('a91f')).toEqual([id]);
    await rename(id, '').expect(200);
    expect((await get(id)).body.displayName).toBeNull();
    expect(await search('payments')).toEqual([]);
    await rename(id, 'svc-a91f-prod').expect(200);
    expect((await get(id)).body.displayName).toBeNull();
  });

  it('keeps the name when the resource is synced again or recreated with the same ARN', async () => {
    const accountId = await addAccount();
    const id = await addResource(accountId, 'ec2-instance', 'i-0abc', 'i-0abc');
    await rename(id, 'Game proxy 1').expect(200);
    await context.owner.deleteFrom('resources').where('id', '=', id).execute();
    const recreated = await addResource(accountId, 'ec2-instance', 'i-0abc', 'i-0abc');
    expect((await get(recreated)).body.displayName).toBe('Game proxy 1');
  });

  it('shows the current display name on older activity, and records each rename', async () => {
    const id = await addResource(await addAccount(), 'rds-instance', 'db-7');
    await context.owner
      .insertInto('audit_events')
      .values({
        tenant_id: tenantId(),
        action: 'cloud.action.completed',
        target_type: 'resource',
        target_id: id,
        metadata: JSON.stringify({ label: 'db-7' }),
      })
      .execute();
    await rename(id, 'Reports database').expect(200);
    await rename(id, 'Reporting DB').expect(200);
    const { body } = await http().get(`/api/audit-events?resource=${id}`).set('Cookie', admin).expect(200);
    expect(
      body.events.map(({ action, targetDisplayName }: { action: string; targetDisplayName: string }) => [
        action,
        targetDisplayName,
      ]),
    ).toEqual([
      ['resource.renamed', 'Reporting DB'],
      ['resource.renamed', 'Reporting DB'],
      ['cloud.action.completed', 'Reporting DB'],
    ]);
    expect(body.events[0].metadata).toMatchObject({ label: 'db-7', from: 'Reports database', to: 'Reporting DB' });
  });

  it('needs Manage environments, refuses long names, and keeps projects apart', async () => {
    const id = await addResource(await addAccount(), 'ecs-cluster', 'cluster-x');
    await rename(id, 'Frontend', developer).expect(403);
    await setExtraPermissions(context, context.acme, 'developer', ['environments.manage']);
    await rename(id, 'Frontend', developer).expect(200);
    expect((await rename(id, 'x'.repeat(81))).body.message).toBe('A display name can be up to 80 characters.');
    await rename(id, 'Theirs', otherAdmin).expect(404);
    expect((await get(id)).body.displayName).toBe('Frontend');
    const seen = await context.owner
      .selectFrom('resource_display_names')
      .select(['tenant_id', 'updated_by_email'])
      .execute();
    expect(seen).toEqual([{ tenant_id: tenantId(), updated_by_email: 'dev@example.test' }]);
  });
});
