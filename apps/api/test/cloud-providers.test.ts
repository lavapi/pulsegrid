import type { Resource } from '@pulsegrid/shared';
import type Redis from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import {
  CLOUD_PROVIDER_LIST,
  type CloudProvider,
  defineProvider,
} from '../src/inventory/providers/provider';
import { InventorySyncService } from '../src/inventory/sync/inventory-sync.service';
import { REDIS } from '../src/redis/redis.module';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

const PROJECT_ID = 'my-project-123';

type OtherStored = { token: string } | { roleName: string; externalId: string };

const otherCloud: CloudProvider = defineProvider<{ token: string }, OtherStored>({
  id: 'othercloud',
  unfilteredTypes: [],
  collectors: [
    {
      name: 'storage',
      label: 'Storage',
      scope: 'global',
      types: ['s3-bucket'],
      collect: async ({ credentials }) => [
        {
          type: 's3-bucket',
          region: 'global',
          nativeId: `bucket-${credentials.token}`,
          name: 'media',
          status: 'ready',
          health: 'healthy',
          tags: {},
          details: {},
        },
      ],
    },
  ],
  parseCredentials: (input) => {
    const { token, roleName, externalId } = input as { token?: string; roleName?: string; externalId?: string };
    if (roleName && externalId) {
      return { roleName, externalId };
    }
    return token ? { token } : null;
  },
  credentialHint: (stored) => ('roleName' in stored ? `Role ${stored.roleName}` : `…${stored.token.slice(-2)}`),
  credentialKind: (stored) => ('roleName' in stored ? 'role' : 'key'),
  resolveCredentials: async (stored) =>
    'roleName' in stored ? { token: `assumed-${stored.roleName}-with-${stored.externalId}` } : stored,
  isValidRegion: (region) => region === 'moon-1',
  checkCredentials: async () => ({ accountId: PROJECT_ID, services: [], canWrite: false, missingActions: null }),
  actions: [],
  activityWatches: [],
  failureMessage: () => 'Could not read.',
  actionFailureMessage: () => 'Could not do that.',
  buildMap: (resources) => ({
    groups: [],
    nodes: resources.map(({ id, name, status, health }) => ({
      id,
      category: 's3',
      typeLabel: 'Storage',
      name,
      awsName: null,
      status,
      health,
      groupId: null,
      href: null,
    })),
    edges: [],
    truncated: false,
  }),
});

describe('cloud providers', () => {
  let context: TestContext;
  let admin: string;

  const http = () => request(context.app.getHttpServer());
  const add = (body: object) => http().post('/api/cloud/accounts').set('Cookie', admin).send(body);
  const account = {
    provider: 'othercloud',
    credentials: { token: 'secret-token-42' },
    name: 'Other',
    regions: ['moon-1'],
    environmentId: null,
  };

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([awsProvider, otherCloud]),
    );
    admin = await signIn(context, context.acme, user('ada', 'admin'));
  });
  afterAll(() => context.close());

  beforeEach(async () => {
    await context.app.get<Redis>(REDIS).flushdb();
    await context.owner.deleteFrom('cloud_accounts').execute();
  });

  it('runs a second provider through accounts, sync, resources and the map', async () => {
    const { body: saved } = await add(account).expect(201);
    expect(saved).toMatchObject({
      provider: 'othercloud',
      accountId: PROJECT_ID,
      credentialHint: '…42',
      hasCredentials: true,
    });

    const sync = context.app.get(InventorySyncService);
    await sync.syncAccount({ tenantId: context.acme.tenant.id, accountId: saved.id });

    const { body: page } = await http().get(`/api/resources?account=${saved.id}`).set('Cookie', admin).expect(200);
    expect(page.resources.map(({ name }: Resource) => name)).toEqual(['media']);
    const { body: map } = await http().get(`/api/resources/map?account=${saved.id}`).set('Cookie', admin).expect(200);
    expect(map.nodes.map(({ name }: { name: string }) => name)).toEqual(['media']);
  });

  it('never returns stored credentials', async () => {
    await add(account).expect(201);
    const { text } = await http().get('/api/cloud/accounts').set('Cookie', admin).expect(200);
    expect(text).not.toContain('secret-token-42');
  });

  it('uses each provider to validate its own input', async () => {
    await add({ ...account, regions: ['eu-central-1'] }).expect(400);
    await add({ ...account, credentials: {} }).expect(400);
  });

  it('refuses a provider that does not exist', async () => {
    const response = await add({ ...account, provider: 'nope' });
    expect(response.status).toBe(400);
    expect(response.body.message).toBe("That cloud provider isn't available.");
  });

  it('keeps the same account ID apart across providers', async () => {
    const { body: first } = await add(account).expect(201);
    await context.owner
      .insertInto('cloud_accounts')
      .values({
        tenant_id: context.acme.tenant.id,
        provider: 'aws',
        account_id: PROJECT_ID,
        name: 'Same ID',
        regions: ['eu-central-1'],
      })
      .execute();
    const { body } = await http().get('/api/cloud/accounts').set('Cookie', admin).expect(200);
    expect(body).toHaveLength(2);
    expect(body.map(({ id }: { id: string }) => id)).toContain(first.id);
  });

  describe('connecting with a role', () => {
    const roleAccount = { ...account, credentials: { roleName: 'PulseGridAccess', externalId: 'sent-by-the-browser' } };

    it("uses the project's own External ID, stores the kind, and calls the cloud with the role's credentials", async () => {
      const { body: trust } = await http().get('/api/cloud/accounts/role-trust').set('Cookie', admin).expect(200);
      expect(trust.externalId).toMatch(/^pulsegrid-[\w-]{32}$/);

      const { body: saved } = await add(roleAccount).expect(201);
      expect(saved).toMatchObject({ credentialKind: 'role', credentialHint: 'Role PulseGridAccess', hasCredentials: true });

      await context.app.get(InventorySyncService).syncAccount({ tenantId: context.acme.tenant.id, accountId: saved.id });
      const { body: page } = await http().get(`/api/resources?account=${saved.id}`).set('Cookie', admin).expect(200);
      expect(page.resources.map(({ nativeId }: Resource) => nativeId)).toEqual([
        `bucket-assumed-PulseGridAccess-with-${trust.externalId}`,
      ]);
    });

    it('gives each project its own stable External ID', async () => {
      const ids = await Promise.all([
        http().get('/api/cloud/accounts/role-trust').set('Cookie', admin),
        http().get('/api/cloud/accounts/role-trust').set('Cookie', admin),
      ]);
      expect(ids[0]?.body.externalId).toBe(ids[1]?.body.externalId);
      const other = await signIn(context, context.globex, user('gia', 'admin'));
      const { body: elsewhere } = await http().get('/api/cloud/accounts/role-trust').set('Cookie', other).expect(200);
      expect(elsewhere.externalId).not.toBe(ids[0]?.body.externalId);
    });

    it('switches an account from a key to a role', async () => {
      const { body: saved } = await add(account).expect(201);
      expect(saved.credentialKind).toBe('key');
      const { body: switched } = await http()
        .put(`/api/cloud/accounts/${saved.id}/credentials`)
        .set('Cookie', admin)
        .send({ credentials: roleAccount.credentials })
        .expect(200);
      expect(switched).toMatchObject({ credentialKind: 'role', credentialHint: 'Role PulseGridAccess' });
      const { text } = await http().get('/api/cloud/accounts').set('Cookie', admin).expect(200);
      expect(text).not.toContain('secret-token-42');
    });
  });
});

