import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signIn, startTestApp, type TestContext, user, } from './support/test-app';

interface Seed {
  name: string;
  accountId: string;
  resources: { type: string; service: string; name: string; health?: string; details?: object }[];
}

describe('environments', () => {
  let context: TestContext;
  let admin: string;
  let viewer: string;
  let other: string;

  const http = () => request(context.app.getHttpServer());
  const tenantId = () => context.acme.tenant.id;

  const seedAccount = async ({ name, accountId, resources }: Seed): Promise<string> => {
    const { id } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        tenant_id: tenantId(),
        provider: 'aws',
        account_id: accountId,
        name,
        regions: ['eu-central-1'],
        status: 'connected',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const resource of resources) {
      await context.owner
        .insertInto('resources')
        .values({
          tenant_id: tenantId(),
          cloud_account_id: id,
          region: 'eu-central-1',
          type: resource.type as never,
          service: resource.service as never,
          native_id: `${accountId}-${resource.name}`,
          name: resource.name,
          status: 'running',
          health: (resource.health ?? 'healthy') as never,
          tags: '{}',
          details: JSON.stringify(resource.details ?? {}),
          last_seen_at: new Date(),
        })
        .execute();
    }
    return id;
  };

  const accounts = async () => (await http().get('/api/cloud/accounts').set('Cookie', admin).expect(200)).body;

  const environments = async (cookie: string) =>
    (await http().get('/api/environments').set('Cookie', cookie).expect(200)).body;

  beforeAll(async () => {
    context = await startTestApp();
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    other = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());

  let staging: string;
  let production: string;
  let audit: string;

  beforeEach(async () => {
    await context.owner.deleteFrom('cloud_accounts').execute();
    await context.owner.deleteFrom('environments').execute();
    staging = await seedAccount({
      name: 'Staging',
      accountId: '111111111111',
      resources: [
        { type: 'ecs-service', service: 'ecs', name: 'api-staging', details: { desiredTasks: 1 } },
        { type: 'rds-instance', service: 'rds', name: 'db-staging', details: { engineVersion: '16' } },
        { type: 's3-bucket', service: 's3', name: 'extra-staging' },
      ],
    });
    production = await seedAccount({
      name: 'Production',
      accountId: '222222222222',
      resources: [
        { type: 'ecs-service', service: 'ecs', name: 'api-prod', health: 'degraded', details: { desiredTasks: 4 } },
        { type: 'rds-instance', service: 'rds', name: 'db-prod', details: { engineVersion: '16' } },
      ],
    });
    audit = await seedAccount({ name: 'Audit', accountId: '333333333333', resources: [] });
  });

  it('groups accounts by name and leaves others out', async () => {
    const body = await environments(admin);
    expect(body.map((item: { name: string }) => item.name)).toEqual(['Staging', 'Production']);
    expect(body[0].accounts.map((item: { name: string }) => item.name)).toEqual(['Staging']);
  });

  it('labels accounts with their environment', async () => {
    await environments(admin);
    const labels = (await accounts()).map(({ name, environmentName, isProduction }: Record<string, unknown>) => ({
      name,
      environmentName,
      isProduction,
    }));
    expect(labels).toEqual([
      { name: 'Audit', environmentName: null, isProduction: false },
      { name: 'Production', environmentName: 'Production', isProduction: true },
      { name: 'Staging', environmentName: 'Staging', isProduction: false },
    ]);
  });

  it('summarises health per environment and service', async () => {
    const [, prod] = await environments(admin);
    expect(prod.health).toEqual({ healthy: 1, degraded: 1, stopped: 0, unknown: 0, total: 2 });
    expect(prod.services.map((item: { service: string }) => item.service)).toEqual(['ecs', 'rds']);
    expect(prod.services[0].health).toMatchObject({ degraded: 1, total: 1 });
  });

  it('filters resources by environment', async () => {
    const [stage] = await environments(admin);
    const { body } = await http().get(`/api/resources?environment=${stage.id}`).set('Cookie', admin);
    expect(body.resources.map((item: { name: string }) => item.name).sort()).toEqual([
      'api-staging',
      'db-staging',
      'extra-staging',
    ]);
  });

  it('compares environments', async () => {
    const [stage, prod] = await environments(admin);
    const { body } = await http()
      .get(`/api/environments/compare?left=${stage.id}&right=${prod.id}`)
      .set('Cookie', admin)
      .expect(200);
    const state = (key: string) => body.rows.find((row: { key: string }) => row.key === key);
    expect(state('api')).toMatchObject({
      state: 'different',
      differences: [{ field: 'desiredTasks', left: '1', right: '4' }],
    });
    expect(state('db').state).toBe('same');
    expect(state('extra').state).toBe('only_left');
  });

  it('rejects an invalid comparison with a friendly message', async () => {
    const response = await http().get('/api/environments/compare?left=x&right=y').set('Cookie', admin);
    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Choose two environments to compare.');
  });

  describe('managing', () => {
    it('only lets admins manage environments', async () => {
      await http().get('/api/environments/manage').set('Cookie', viewer).expect(403);
      await http().post('/api/environments').set('Cookie', viewer).send({ name: 'X' }).expect(403);
    });

    it('creates, renames and removes environments', async () => {
      const { body } = await http().post('/api/environments').set('Cookie', admin).send({ name: 'Sandbox' }).expect(201);
      const renamed = await http().put(`/api/environments/${body.id}`).set('Cookie', admin).send({ name: 'Lab' }).expect(200);
      expect(renamed.body.name).toBe('Lab');
      await http().delete(`/api/environments/${body.id}`).set('Cookie', admin).expect(204);

      const audited = await http().get('/api/audit-events').set('Cookie', admin);
      const actions = audited.body.events.map((event: { action: string }) => event.action);
      expect(actions).toEqual(expect.arrayContaining(['environment.created', 'environment.renamed', 'environment.removed']));
    });

    it('rejects duplicate names with a friendly message', async () => {
      await http().post('/api/environments').set('Cookie', admin).send({ name: 'Sandbox' }).expect(201);
      const response = await http().post('/api/environments').set('Cookie', admin).send({ name: 'Sandbox' });
      expect(response.status).toBe(409);
      expect(response.body.message).toBe('An environment with that name already exists.');
    });

    it('combines accounts and keeps a manual choice', async () => {
      const [stage] = await environments(admin);
      await http()
        .put(`/api/environments/accounts/${audit}`)
        .set('Cookie', admin)
        .send({ environmentId: stage.id })
        .expect(204);
      await http().put(`/api/environments/accounts/${production}`).set('Cookie', admin).send({ environmentId: null }).expect(204);

      const body = await environments(admin);
      expect(body).toHaveLength(1);
      expect(body[0].accounts.map((item: { name: string }) => item.name)).toEqual(['Audit', 'Staging']);
    });

    it('keeps accounts when an environment is removed', async () => {
      const [stage] = await environments(admin);
      await http().delete(`/api/environments/${stage.id}`).set('Cookie', admin).expect(204);
      const account = await context.owner.selectFrom('cloud_accounts').selectAll().where('id', '=', staging).executeTakeFirstOrThrow();
      expect(account.environment_id).toBeNull();
      expect((await environments(admin)).map((item: { name: string }) => item.name)).toEqual(['Production']);
    });

    describe('domains', () => {
      const addDomain = (environmentId: string, body: object, cookie = admin) =>
        http().post(`/api/environments/${environmentId}/domains`).set('Cookie', cookie).send(body);
      const managed = async () =>
        (await http().get('/api/environments/manage').set('Cookie', admin).expect(200)).body.environments;

      it('adds app and Grafana domains and shows them on the environment', async () => {
        const [stage] = await environments(admin);
        await addDomain(stage.id, { kind: 'grafana', url: 'https://grafana.staging.example.com/' }).expect(201);
        const { body } = await addDomain(stage.id, { kind: 'app', label: ' Website ', url: 'staging.example.com' }).expect(201);
        expect(body).toEqual({ id: expect.any(String), kind: 'app', label: 'Website', url: 'https://staging.example.com' });

        const expected = [
          { id: expect.any(String), kind: 'app', label: 'Website', url: 'https://staging.example.com' },
          { id: expect.any(String), kind: 'grafana', label: null, url: 'https://grafana.staging.example.com' },
        ];
        expect((await managed()).find((item: { id: string }) => item.id === stage.id).domains).toEqual(expected);
        const summary = await http().get(`/api/environments/${stage.id}`).set('Cookie', viewer).expect(200);
        expect(summary.body.domains).toEqual(expected);
      });

      it('removes a domain and records both changes', async () => {
        const [stage] = await environments(admin);
        const { body } = await addDomain(stage.id, { kind: 'app', url: 'staging.example.com' }).expect(201);
        await http().delete(`/api/environments/domains/${body.id}`).set('Cookie', admin).expect(204);
        expect((await managed())[0].domains).toEqual([]);

        const audited = await http().get('/api/audit-events').set('Cookie', admin);
        const actions = audited.body.events.map((event: { action: string }) => event.action);
        expect(actions).toEqual(expect.arrayContaining(['environment.domain_added', 'environment.domain_removed']));
      });

      it('refuses addresses that are not web addresses, and duplicates', async () => {
        const [stage] = await environments(admin);
        for (const url of ['not a domain', 'ftp://files.example.com', 'https://user:secret@example.com', 'intranet']) {
          const response = await addDomain(stage.id, { kind: 'app', url });
          expect(response.status).toBe(400);
          expect(response.body.message).toBe('Enter a web address like staging.example.com.');
        }
        const wrongKind = await addDomain(stage.id, { kind: 'kibana', url: 'example.com' });
        expect(wrongKind.status).toBe(400);
        await addDomain(stage.id, { kind: 'app', url: 'staging.example.com' }).expect(201);
        const duplicate = await addDomain(stage.id, { kind: 'grafana', url: 'https://staging.example.com' });
        expect(duplicate.status).toBe(409);
        expect(duplicate.body.message).toBe('That address is already on this environment.');
      });

      const editDomain = (id: string, body: object, cookie = admin) =>
        http().put(`/api/environments/domains/${id}`).set('Cookie', cookie).send(body);

      it('edits a domain and records the change', async () => {
        const [stage] = await environments(admin);
        const { body } = await addDomain(stage.id, { kind: 'app', url: 'old.example.com' }).expect(201);
        const edited = await editDomain(body.id, { kind: 'grafana', label: 'Metrics', url: 'grafana.example.com' }).expect(200);
        expect(edited.body).toEqual({ id: body.id, kind: 'grafana', label: 'Metrics', url: 'https://grafana.example.com' });
        expect((await managed())[0].domains).toEqual([edited.body]);

        const audited = await http().get('/api/audit-events').set('Cookie', admin);
        const event = audited.body.events.find((item: { action: string }) => item.action === 'environment.domain_updated');
        expect(event.metadata).toMatchObject({
          label: 'https://grafana.example.com',
          previous: 'https://old.example.com',
          environment: 'Staging',
        });
      });

      it('checks edited addresses like new ones', async () => {
        const [stage] = await environments(admin);
        await addDomain(stage.id, { kind: 'app', url: 'taken.example.com' }).expect(201);
        const { body } = await addDomain(stage.id, { kind: 'app', url: 'other.example.com' }).expect(201);
        const invalid = await editDomain(body.id, { kind: 'app', url: 'not a domain' });
        expect(invalid.status).toBe(400);
        expect(invalid.body.message).toBe('Enter a web address like staging.example.com.');
        const duplicate = await editDomain(body.id, { kind: 'app', url: 'taken.example.com' });
        expect(duplicate.status).toBe(409);
        expect(duplicate.body.message).toBe('That address is already on this environment.');
        await editDomain(body.id, { kind: 'app', label: 'Same', url: 'other.example.com' }).expect(200);
      });

      it('lets everyone read the links of an environment', async () => {
        const [stage] = await environments(admin);
        await addDomain(stage.id, { kind: 'grafana', url: 'grafana.example.com' }).expect(201);
        await addDomain(stage.id, { kind: 'app', url: 'staging.example.com' }).expect(201);
        const { body } = await http().get(`/api/environments/${stage.id}/domains`).set('Cookie', viewer).expect(200);
        expect(body.map((domain: { kind: string }) => domain.kind)).toEqual(['app', 'grafana']);
        await http().get(`/api/environments/${stage.id}/domains`).set('Cookie', other).expect(404);
      });

      it('only lets people who manage environments change domains', async () => {
        const [stage] = await environments(admin);
        const { body } = await addDomain(stage.id, { kind: 'app', url: 'staging.example.com' }).expect(201);
        await addDomain(stage.id, { kind: 'app', url: 'other.example.com' }, viewer).expect(403);
        await http().delete(`/api/environments/domains/${body.id}`).set('Cookie', viewer).expect(403);
        await editDomain(body.id, { kind: 'app', url: 'evil.example.com' }, viewer).expect(403);
      });

      it('keeps domains inside their tenant and removes them with the environment', async () => {
        const [stage] = await environments(admin);
        const { body } = await addDomain(stage.id, { kind: 'app', url: 'staging.example.com' }).expect(201);
        await addDomain(stage.id, { kind: 'app', url: 'evil.example.com' }, other).expect(404);
        await http().delete(`/api/environments/domains/${body.id}`).set('Cookie', other).expect(404);
        await editDomain(body.id, { kind: 'app', url: 'evil.example.com' }, other).expect(404);

        await http().delete(`/api/environments/${stage.id}`).set('Cookie', admin).expect(204);
        expect(await context.owner.selectFrom('environment_domains').selectAll().execute()).toEqual([]);
      });
    });

    it('keeps environments inside their tenant', async () => {
      const [stage] = await environments(admin);
      await http().get(`/api/environments/${stage.id}`).set('Cookie', other).expect(404);
      await http().put(`/api/environments/${stage.id}`).set('Cookie', other).send({ name: 'Hacked' }).expect(404);
      await http().delete(`/api/environments/${stage.id}`).set('Cookie', other).expect(404);
      expect(await environments(other)).toEqual([]);
    });
  });
});
