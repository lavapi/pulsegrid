import type { InfrastructureMap } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

describe('infrastructure map', () => {
  let context: TestContext;
  let admin: string;
  let other: string;
  let accountId: string;

  const http = () => request(context.app.getHttpServer());
  const tenantId = () => context.acme.tenant.id;

  const seed = (type: string, service: string, name: string, details: object) =>
    context.owner
      .insertInto('resources')
      .values({
        tenant_id: tenantId(),
        cloud_account_id: accountId,
        region: 'eu-central-1',
        type: type as never,
        service: service as never,
        native_id: name,
        name,
        status: 'running',
        health: 'healthy',
        tags: '{}',
        details: JSON.stringify(details),
        last_seen_at: new Date(),
      })
      .execute();

  const load = async (cookie: string): Promise<InfrastructureMap> =>
    (await http().get(`/api/resources/map?account=${accountId}`).set('Cookie', cookie).expect(200)).body;

  beforeAll(async () => {
    context = await startTestApp();
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    other = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());

  beforeEach(async () => {
    await context.owner.deleteFrom('cloud_accounts').execute();
    ({ id: accountId } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        tenant_id: tenantId(),
        provider: 'aws',
        account_id: '111111111111',
        name: 'Staging',
        regions: ['eu-central-1'],
        status: 'connected',
      })
      .returning('id')
      .executeTakeFirstOrThrow());
    await seed('load-balancer', 'network', 'web-lb', {
      vpcId: 'vpc-1',
      scheme: 'internet-facing',
      targetGroups: ['tg'],
    });
    await seed('ecs-service', 'ecs', 'api', { targetGroups: ['tg'], securityGroups: ['sg-app'] });
    await seed('rds-instance', 'rds', 'db', { vpcId: 'vpc-1', securityGroups: ['sg-db'] });
    await seed('security-group', 'network', 'sg-db', {
      allowedFrom: [{ groupId: 'sg-app', fromPort: 5432, toPort: 5432 }],
    });
  });

  it('builds the map from synced resources', async () => {
    const map = await load(admin);
    expect(map.nodes.map(({ name }) => name).sort()).toEqual(['Internet', 'api', 'db', 'web-lb']);
    expect(map.edges.map(({ kind, label }) => [kind, label])).toEqual([
      ['exact', null],
      ['exact', null],
      ['allowed', '5432'],
    ]);
  });

  it('shows nothing to another tenant', async () => {
    const map = await load(other);
    expect(map.nodes).toEqual([]);
  });

  it('needs an account', async () => {
    await http().get('/api/resources/map').set('Cookie', admin).expect(400);
  });
});
