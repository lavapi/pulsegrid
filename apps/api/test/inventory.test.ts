import type { CredentialCheck } from '@pulsegrid/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/connection';
import type { Database } from '../src/database/schema';
import type { Kysely } from 'kysely';
import { newEnvironment } from '../src/inventory/environments/account-environment';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import {
  CLOUD_PROVIDER_LIST,
  type CloudProvider,
  type CollectedResource,
  CredentialsRejected,
  type ResourceCollector,
} from '../src/inventory/providers/provider';
import { InventorySyncService } from '../src/inventory/sync/inventory-sync.service';
import {
  appUrl,
  signIn,
  startTestApp,
  type TestContext,
  user,
} from './support/test-app';

const named = (name: string, overrides: Partial<CollectedResource> = {}): CollectedResource => ({
  type: 'ec2-instance',
  region: 'eu-central-1',
  nativeId: `id-${name}`,
  name,
  status: 'running',
  health: 'healthy',
  tags: { env: 'staging' },
  details: { instanceType: 't3.micro' },
  ...overrides,
});

const SECRET = 'abcdEFGHijklMNOPqrstUVWXyz0123456789+/AB';
const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: SECRET };

let sequence = 100000000000;
const newAccountId = (): string => String(++sequence);

const passingCheck = {
  accountId: '',
  services: [{ service: 'ec2' as const, label: 'EC2', readable: true }],
  canWrite: false,
};

const fakes = {
  check: async (): Promise<CredentialCheck> => ({
    ...passingCheck,
    accountId: newAccountId(),
  }),
  regional: async (): Promise<CollectedResource[]> => [],
  global: async (): Promise<CollectedResource[]> => [],
};

const defaultCheck = fakes.check;

const collectors: ResourceCollector[] = [
  { name: 'ec2', label: 'EC2', scope: 'regional', types: ['ec2-instance'], collect: ({ region }) => fakes.regional().then((items) => items.filter((item) => item.region === region)) },
  { name: 's3', label: 'S3', scope: 'global', types: ['s3-bucket'], collect: () => fakes.global() },
];

const provider: CloudProvider = {
  ...awsProvider,
  collectors,
  checkCredentials: () => fakes.check(),
};

const accessDenied = Object.assign(new Error('raw aws text'), { name: 'AccessDenied' });

describe('AWS inventory', () => {
  let context: TestContext;
  let admin: string;
  let developer: string;
  let viewer: string;
  let otherAdmin: string;

  const http = () => request(context.app.getHttpServer());
  const integration = (regions: string[], name = 'Production') => ({
    provider: 'aws',
    credentials: KEY,
    name,
    regions,
    environmentId: null,
  });
  const connect = async (regions = ['eu-central-1', 'eu-west-1']) => {
    const { body } = await http()
      .post('/api/cloud/accounts')
      .set('Cookie', admin)
      .send(integration(regions))
      .expect(201);
    return body as { id: string; accountId: string };
  };
  const sync = (accountId: string) =>
    context.app.get(InventorySyncService).syncAccount({ tenantId: context.acme.tenant.id, accountId });
  const resourcesOf = async (accountId: string, cookie = admin) => {
    const { body } = await http().get(`/api/resources?account=${accountId}`).set('Cookie', cookie).expect(200);
    return body.resources as { name: string; id: string }[];
  };

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]),
    );
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    developer = await signIn(context, context.acme, user('dev', 'developer'));
    otherAdmin = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());

  beforeEach(() => {
    fakes.check = defaultCheck;
    fakes.regional = async () => [];
    fakes.global = async () => [];
  });

  describe('integrations', () => {
    const replaceKey = (id: string, cookie = admin) =>
      http().put(`/api/cloud/accounts/${id}/credentials`).set('Cookie', cookie).send({ credentials: KEY });
    const check = (credentials: Record<string, string> = KEY) =>
      http().post('/api/cloud/accounts/check').set('Cookie', admin).send({ provider: 'aws', credentials });

    it('refuses an environment from another project', async () => {
      const foreign = await context.owner
        .insertInto('environments')
        .values(newEnvironment(context.globex.tenant.id, 'Globex staging'))
        .returning('id')
        .executeTakeFirstOrThrow();
      const response = await http()
        .post('/api/cloud/accounts')
        .set('Cookie', admin)
        .send({ ...integration(['eu-central-1']), environmentId: foreign.id });
      expect(response.status).toBe(404);
      expect(response.body.message).toBe('That environment no longer exists.');
    });

    it('only lets admins add accounts or test credentials', async () => {
      await http().post('/api/cloud/accounts').set('Cookie', viewer).send(integration(['eu-central-1'])).expect(403);
      await http()
        .post('/api/cloud/accounts/check')
        .set('Cookie', developer)
        .send({ provider: 'aws', credentials: KEY })
        .expect(403);
    });

    it('rejects invalid regions and credentials, without echoing the secret', async () => {
      const region = await http().post('/api/cloud/accounts').set('Cookie', admin).send(integration(['nowhere']));
      expect(region.status).toBe(400);
      expect(region.body.message).toBe('Choose valid regions for this provider.');
      const secret = await http()
        .post('/api/cloud/accounts')
        .set('Cookie', admin)
        .send({ ...integration(['eu-central-1']), credentials: { ...KEY, secretAccessKey: 'too-short' } });
      expect(secret.status).toBe(400);
      expect(secret.text).not.toContain('too-short');
    });

    it('refuses temporary keys', async () => {
      await check({ ...KEY, accessKeyId: 'ASIAABCDEFGHIJKLMNOP' }).expect(400);
    });

    it('shows the message a provider gives for rejected credentials', async () => {
      fakes.check = async () => {
        throw new CredentialsRejected("Root account keys aren't allowed.");
      };
      const response = await check();
      expect(response.status).toBe(400);
      expect(response.body.message).toBe("Root account keys aren't allowed.");
    });

    it('hides unexpected errors behind a friendly message', async () => {
      fakes.check = async () => {
        throw new Error('raw aws text');
      };
      const response = await check();
      expect(response.status).toBe(400);
      expect(response.text).not.toContain('raw aws text');
      expect(response.body.message).toBe("We couldn't check those credentials. Please try again.");
    });

    it('reports what credentials can read before saving them', async () => {
      const { body } = await check().expect(200);
      expect(body).toMatchObject({ services: [{ service: 'ec2', readable: true }], canWrite: false });
    });

    it('never returns or stores the secret in plain text', async () => {
      const account = await connect();
      const { text } = await http().get('/api/cloud/accounts').set('Cookie', admin).expect(200);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(KEY.accessKeyId);
      expect(text).toContain('AKIA…MNOP');
      const row = await context.owner
        .selectFrom('cloud_accounts')
        .select('encrypted_credentials')
        .where('id', '=', account.id)
        .executeTakeFirstOrThrow();
      expect(row.encrypted_credentials).not.toContain(SECRET);
      const audit = await http().get('/api/audit-events').set('Cookie', admin);
      expect(audit.text).not.toContain(SECRET);
    });

    it('remembers a key that can change resources', async () => {
      fakes.check = async () => ({ ...passingCheck, accountId: newAccountId(), canWrite: true });
      const account = await connect();
      const { body } = await http().get('/api/cloud/accounts').set('Cookie', admin);
      expect(body.find(({ id }: { id: string }) => id === account.id).canWrite).toBe(true);
    });

    it('takes over an account that has no key, keeping its resources', async () => {
      const accountId = newAccountId();
      const { id } = await context.owner
        .insertInto('cloud_accounts')
        .values({ tenant_id: context.acme.tenant.id, provider: 'aws', account_id: accountId, name: 'Old', regions: ['eu-central-1'], status: 'connected' })
        .returning('id')
        .executeTakeFirstOrThrow();
      fakes.check = async () => ({ ...passingCheck, accountId });
      const { body } = await http().post('/api/cloud/accounts').set('Cookie', admin).send(integration(['eu-central-1'], 'New')).expect(201);
      expect(body).toMatchObject({ id, name: 'New', hasCredentials: true, status: 'connected' });
    });

    it('rejects a second key for the same account', async () => {
      const accountId = newAccountId();
      fakes.check = async () => ({ ...passingCheck, accountId });
      await connect();
      const response = await http().post('/api/cloud/accounts').set('Cookie', admin).send(integration(['eu-central-1']));
      expect(response.status).toBe(409);
      expect(response.body.message).toBe('That account already has credentials. Replace them instead.');
    });

    it('replaces a key only with one from the same account', async () => {
      const account = await connect();
      fakes.check = async () => ({ ...passingCheck, accountId: account.accountId });
      await replaceKey(account.id).expect(200);
      await replaceKey(account.id, viewer).expect(403);
      fakes.check = defaultCheck;
      const response = await replaceKey(account.id);
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Those credentials belong to a different account.');
    });

    describe('tag filters', () => {
      const update = (id: string, tagFilter: object, name = 'Production') =>
        http()
          .put(`/api/cloud/accounts/${id}`)
          .set('Cookie', admin)
          .send({ name, regions: ['eu-central-1'], tagFilter });
      const rules = (include: object[], exclude: object[] = [], keepUntagged = false) => ({
        include,
        exclude,
        keepUntagged,
      });
      const tagged = () => [
        named('shop-api', { tags: { Project: 'shop', Layer: 'api' } }),
        named('data-api', { tags: { Project: 'data', Layer: 'api' } }),
        named('untagged', { tags: {} }),
        named('main-vpc', { type: 'vpc', tags: {} }),
      ];
      const names = async (id: string) => (await resourcesOf(id)).map(({ name }) => name).sort();

      beforeEach(() => {
        fakes.regional = async () => tagged();
      });
      afterEach(() => {
        fakes.regional = async () => [];
      });

      it('applies rules from when the account is added', async () => {
        const { body } = await http()
          .post('/api/cloud/accounts')
          .set('Cookie', admin)
          .send({ ...integration(['eu-central-1']), tagFilter: rules([{ key: 'Project', value: 'shop' }]) })
          .expect(201);
        await sync(body.id);
        expect(body.tagFilter.include).toEqual([{ key: 'Project', value: 'shop' }]);
        expect(await names(body.id)).toEqual(['main-vpc', 'shop-api']);
      });

      it('keeps everything with no rules', async () => {
        const { id } = await connect(['eu-central-1']);
        await sync(id);
        expect(await names(id)).toEqual(['data-api', 'main-vpc', 'shop-api', 'untagged']);
      });

      it('removes resources when rules change, and brings them back', async () => {
        const { id } = await connect(['eu-central-1']);
        await sync(id);
        await update(id, rules([], [{ key: 'Project', value: null }])).expect(200);
        await sync(id);
        expect(await names(id)).toEqual(['main-vpc', 'untagged']);
        await update(id, rules([])).expect(200);
        await sync(id);
        expect(await names(id)).toEqual(['data-api', 'main-vpc', 'shop-api', 'untagged']);
      });

      it('lets exclude win, and keeps untagged resources when asked', async () => {
        const { id } = await connect(['eu-central-1']);
        const filter = rules([{ key: 'Layer', value: 'api' }], [{ key: 'Project', value: 'data' }], true);
        await update(id, filter).expect(200);
        await sync(id);
        expect(await names(id)).toEqual(['main-vpc', 'shop-api', 'untagged']);
      });

      it('records the change and renames the account', async () => {
        const { id } = await connect(['eu-central-1']);
        const { body } = await update(id, rules([]), 'Renamed').expect(200);
        expect(body.name).toBe('Renamed');
        const audit = await http().get('/api/audit-events').set('Cookie', admin);
        expect(audit.body.events[0].action).toBe('cloud.account.updated');
      });

      it('removes resources from regions that are dropped', async () => {
        const { id } = await connect(['eu-central-1', 'eu-west-1']);
        fakes.regional = async () => [named('west', { region: 'eu-west-1' })];
        await sync(id);
        expect(await names(id)).toEqual(['west']);
        await update(id, rules([])).expect(200);
        expect(await names(id)).toEqual([]);
      });

      it('summarises tags without the network resources', async () => {
        const { id } = await connect(['eu-central-1']);
        await sync(id);
        const { body } = await http().get(`/api/cloud/accounts/${id}/tags`).set('Cookie', admin).expect(200);
        expect(body.tagSets).toHaveLength(3);
      });

      it('only lets admins change accounts', async () => {
        const { id } = await connect(['eu-central-1']);
        await http()
          .put(`/api/cloud/accounts/${id}`)
          .set('Cookie', developer)
          .send({ name: 'X', regions: ['eu-central-1'] })
          .expect(403);
        await http().get(`/api/cloud/accounts/${id}/tags`).set('Cookie', developer).expect(403);
        await update(id, rules([{ key: '', value: null }])).expect(400);
      });
    });

    it('marks an account failed when its key stops working', async () => {
      const account = await connect();
      fakes.check = async () => {
        throw new CredentialsRejected('AWS rejected this key.');
      };
      const { body } = await http().post(`/api/cloud/accounts/${account.id}/test`).set('Cookie', admin).expect(200);
      expect(body.status).toBe('error');
      expect(body.lastError).toBe('AWS rejected this key.');
    });

    it('lets developers sync but not viewers, and only accounts with a key', async () => {
      const connected = await connect();
      const { id: keyless } = await context.owner
        .insertInto('cloud_accounts')
        .values({ tenant_id: context.acme.tenant.id, provider: 'aws', account_id: newAccountId(), name: 'Old', regions: ['eu-central-1'], status: 'connected' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await http().post(`/api/cloud/accounts/${connected.id}/sync`).set('Cookie', viewer).expect(403);
      await http().post(`/api/cloud/accounts/${connected.id}/sync`).set('Cookie', developer).expect(202);
      await http().post(`/api/cloud/accounts/${keyless}/sync`).set('Cookie', developer).expect(409);
      const found = await context.app.get(InventorySyncService).connectedAccounts();
      expect(found.map(({ accountId }) => accountId)).not.toContain(keyless);
    });

    it('records account changes in the audit log', async () => {
      const account = await connect();
      await http().delete(`/api/cloud/accounts/${account.id}`).set('Cookie', admin).expect(204);
      const { body } = await http().get('/api/audit-events').set('Cookie', admin);
      const actions = body.events.filter((event: { targetId: string }) => event.targetId === account.id).map((event: { action: string }) => event.action);
      expect(actions).toEqual(['cloud.account.removed', 'cloud.account.added']);
    });

    it('removes resources with the account', async () => {
      const account = await connect();
      fakes.regional = async () => [named('web')];
      await sync(account.id);
      await http().delete(`/api/cloud/accounts/${account.id}`).set('Cookie', admin).expect(204);
      expect(await resourcesOf(account.id)).toEqual([]);
    });
  });

  describe('sync', () => {
    it('stores resources from every region and global collectors once', async () => {
      const account = await connect();
      fakes.regional = async () => [named('frankfurt'), named('ireland', { region: 'eu-west-1' })];
      let globalCalls = 0;
      fakes.global = async () => {
        globalCalls += 1;
        return [named('bucket', { type: 's3-bucket', region: 'eu-central-1' })];
      };

      await sync(account.id);

      expect((await resourcesOf(account.id)).map(({ name }) => name)).toEqual(['bucket', 'frankfurt', 'ireland']);
      expect(globalCalls).toBe(1);
    });

    it('updates existing resources without duplicating them', async () => {
      const account = await connect(['eu-central-1']);
      fakes.regional = async () => [named('web')];
      await sync(account.id);
      const [before] = await resourcesOf(account.id);
      fakes.regional = async () => [named('web', { status: 'stopped', health: 'stopped' })];
      await sync(account.id);

      const { body } = await http().get(`/api/resources?account=${account.id}`).set('Cookie', admin);
      expect(body.resources).toHaveLength(1);
      expect(body.resources[0]).toMatchObject({ id: before?.id, health: 'stopped' });
    });

    it('removes resources that no longer exist', async () => {
      const account = await connect(['eu-central-1']);
      fakes.regional = async () => [named('keep'), named('gone')];
      await sync(account.id);
      fakes.regional = async () => [named('keep')];
      await sync(account.id);
      expect((await resourcesOf(account.id)).map(({ name }) => name)).toEqual(['keep']);
    });

    it('keeps existing data and reports an issue when a collector fails', async () => {
      const account = await connect(['eu-central-1']);
      fakes.regional = async () => [named('web')];
      fakes.global = async () => [named('bucket', { type: 's3-bucket' })];
      await sync(account.id);

      fakes.regional = async () => {
        throw accessDenied;
      };
      fakes.global = async () => [];
      await sync(account.id);

      expect((await resourcesOf(account.id)).map(({ name }) => name)).toEqual(['web']);
      const { body } = await http().get('/api/cloud/accounts').set('Cookie', viewer);
      const saved = body.find((item: { id: string }) => item.id === account.id);
      expect(saved.syncIssues).toEqual([
        {
          collector: 'EC2',
          region: 'eu-central-1',
          message: 'This key does not have permission to read EC2. Check its IAM policy.',
        },
      ]);
      expect(saved.lastSyncedAt).not.toBeNull();
    });

    it('finds connected accounts across tenants with the runtime role', async () => {
      const account = await connect();
      const { body: other } = await http()
        .post('/api/cloud/accounts')
        .set('Cookie', otherAdmin)
        .send(integration(['eu-central-1'], 'Other'))
        .expect(201);

      const found = await context.app.get(InventorySyncService).connectedAccounts();
      const ids = found.map(({ accountId }) => accountId);

      expect(ids).toContain(account.id);
      expect(ids).toContain(other.id);
    });
  });

  describe('resources', () => {
    let accountId: string;

    beforeAll(async () => {
      accountId = (await connect(['eu-central-1'])).id;
      fakes.regional = async () => [
        named('alpha-web'),
        named('alpha_db', { type: 'ec2-instance' }),
        named('beta-web'),
        named('gamma', { nativeId: 'i-findme' }),
      ];
      fakes.global = async () => [named('logs', { type: 's3-bucket' })];
      await sync(accountId);
    });

    it('filters by type', async () => {
      const { body } = await http().get(`/api/resources?account=${accountId}&type=s3-bucket`).set('Cookie', viewer);
      expect(body.resources.map((item: { name: string }) => item.name)).toEqual(['logs']);
    });

    it('searches names and IDs and treats wildcards literally', async () => {
      const search = async (q: string) => {
        const { body } = await http().get(`/api/resources?account=${accountId}&q=${encodeURIComponent(q)}`).set('Cookie', viewer);
        return body.resources.map((item: { name: string }) => item.name).sort();
      };
      expect(await search('ALPHA')).toEqual(['alpha-web', 'alpha_db']);
      expect(await search('i-findme')).toEqual(['gamma']);
      expect(await search('alpha_')).toEqual(['alpha_db']);
      expect(await search('%')).toEqual([]);
    });

    it('pages through every resource once', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = cursor ? `&cursor=${cursor}` : '';
        const { body } = await http().get(`/api/resources?account=${accountId}&limit=2${query}`).set('Cookie', viewer);
        seen.push(...body.resources.map((item: { name: string }) => item.name));
        cursor = body.nextCursor;
      } while (cursor);
      expect([...seen].sort()).toEqual(['alpha-web', 'alpha_db', 'beta-web', 'gamma', 'logs'].sort());
      expect(new Set(seen).size).toBe(5);
    });

    it('rejects a broken cursor and unknown type with a friendly message', async () => {
      for (const query of ['cursor=broken', 'type=nope']) {
        const response = await http().get(`/api/resources?${query}`).set('Cookie', viewer);
        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Those filters are not valid.');
      }
    });

    it('counts resources by type', async () => {
      const { body } = await http().get(`/api/resources/summary?account=${accountId}`).set('Cookie', viewer);
      expect(body).toEqual(
        expect.arrayContaining([
          { type: 'ec2-instance', count: 4 },
          { type: 's3-bucket', count: 1 },
        ]),
      );
    });

    it('groups resources into service categories with health', async () => {
      const { body } = await http().get(`/api/resources/categories?account=${accountId}`).set('Cookie', viewer).expect(200);
      expect(body.map((item: { category: string }) => item.category)).toEqual(['ec2', 's3']);
      expect(body[0]).toMatchObject({
        category: 'ec2',
        health: { healthy: 4, total: 4 },
        types: [{ type: 'ec2-instance', count: 4 }],
      });
    });

    it('filters by service category', async () => {
      const { body } = await http().get(`/api/resources?account=${accountId}&category=s3`).set('Cookie', viewer);
      expect(body.resources.map((item: { name: string }) => item.name)).toEqual(['logs']);
      const degraded = await http().get('/api/resources?health=degraded').set('Cookie', viewer).expect(200);
      expect(degraded.body.resources.every(({ health }: { health: string }) => health === 'degraded')).toBe(true);
      await http().get('/api/resources?health=nope').set('Cookie', viewer).expect(400);
      const invalid = await http().get('/api/resources?category=nope').set('Cookie', viewer);
      expect(invalid.status).toBe(400);
    });

    it('returns one resource with its account', async () => {
      const [first] = await resourcesOf(accountId, viewer);
      const { body } = await http().get(`/api/resources/${first?.id}`).set('Cookie', viewer).expect(200);
      expect(body).toMatchObject({ name: first?.name, cloudAccount: { id: accountId }, tags: { env: 'staging' } });
    });

    it('hides accounts and resources from other tenants', async () => {
      const [first] = await resourcesOf(accountId);
      await http().get(`/api/resources/${first?.id}`).set('Cookie', otherAdmin).expect(404);
      await http().delete(`/api/cloud/accounts/${accountId}`).set('Cookie', otherAdmin).expect(404);
      expect(await resourcesOf(accountId, otherAdmin)).toEqual([]);
    });

    it('applies row-level security to the new tables', async () => {
      const app: Kysely<Database> = createDatabase(appUrl);
      const { rows } = await sql`select count(*)::int as count from resources`.execute(app);
      const accounts = await app.selectFrom('cloud_accounts').selectAll().execute();
      await app.destroy();
      expect(rows).toEqual([{ count: 0 }]);
      expect(accounts).toEqual([]);
    });
  });
});
