import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import { CLOUD_PROVIDER_LIST, type CloudProvider, type LogResult } from '../src/inventory/providers/provider';
import { setExtraPermissions, signIn, startTestApp, type TestContext, user } from './support/test-app';
import { newEnvironment } from '../src/inventory/environments/account-environment';

const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'never-shown' };
const LINE = { id: '1', timestamp: '2026-11-06T12:00:00.000Z', stream: 's', message: 'sensitive log line' };
const read = vi.fn<() => Promise<LogResult>>();
const provider: CloudProvider = {
  ...awsProvider,
  actions: [],
  logSource: { resourceType: 'ecs-service', read },
};

describe('service logs', () => {
  let context: TestContext;
  let owner: string;
  let developer: string;
  let otherOwner: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());

  const addService = async (environment: string, type = 'ecs-service') => {
    const tenantId = context.acme.tenant.id;
    sequence += 1;
    const row = { tenant_id: tenantId, provider: 'aws', account_id: String(400000000000 + sequence) };
    const { id: environmentId } = await context.owner
      .insertInto('environments')
      .values(newEnvironment(tenantId, environment, sequence))
      .onConflict((conflict) => conflict.columns(['tenant_id', 'name']).doUpdateSet({ sort_order: sequence }))
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id: accountId } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        ...row,
        name: 'Account',
        regions: ['eu-central-1'],
        encrypted_credentials: context.app.get(CredentialVault).seal(row, KEY),
        credential_hint: null,
        can_write: false,
        last_error: null,
        last_synced_at: null,
        environment_id: environmentId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { id } = await context.owner
      .insertInto('resources')
      .values({
        tenant_id: tenantId,
        cloud_account_id: accountId,
        region: 'eu-central-1',
        type: type as 'ecs-service',
        service: 'ecs',
        native_id: `arn:${sequence}`,
        name: 'api',
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

  const logs = (id: string, cookie = owner, query = 'since=2026-11-06T11:00:00Z') =>
    http().get(`/api/resources/${id}/logs?${query}`).set('Cookie', cookie);
  const auditOf = (id: string) =>
    context.owner.selectFrom('audit_events').select(['action', 'metadata']).where('target_id', '=', id).execute();
  const grant = () => setExtraPermissions(context, context.acme, 'developer', ['logs.read']);

  beforeAll(async () => {
    context = await startTestApp((builder) => builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]));
    owner = await signIn(context, context.acme, user('ada', 'admin'));
    developer = await signIn(context, context.acme, user('dev', 'developer'));
    otherOwner = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    read.mockReset();
    read.mockResolvedValue({ available: true, lines: [LINE] });
    await setExtraPermissions(context, context.acme, 'developer', []);
  });

  it('shows lines without caching them, and passes the search on', async () => {
    const { body, headers } = await logs(await addService('Staging'), owner, 'since=2026-11-06T11:00:00Z&search=fail').expect(200);
    expect(body).toMatchObject({ access: { allowed: true }, available: true, lines: [LINE], error: null });
    expect(headers['cache-control']).toBe('no-store');
    expect(read.mock.calls[0]).toBeDefined();
  });

  it('reads at most the last 24 hours, whatever start is asked for', async () => {
    await logs(await addService('Staging'), owner, 'since=2020-01-01T00:00:00Z').expect(200);
    const { since } = (read.mock.calls[0] as unknown[])[1] as { since: Date };
    expect(Date.now() - since.getTime()).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5000);
  });

  it('works in production, because reading changes nothing', async () => {
    expect((await logs(await addService('Production')).expect(200)).body.lines).toHaveLength(1);
  });

  it('needs the permission, and never calls AWS without it', async () => {
    const id = await addService('Staging');
    const denied = await logs(id, developer).expect(200);
    expect(denied.body).toMatchObject({ access: { allowed: false }, lines: [] });
    expect(denied.body.access.reason).toContain('View logs');
    expect(read).not.toHaveBeenCalled();
    await grant();
    expect((await logs(id, developer).expect(200)).body.lines).toHaveLength(1);
  });

  it('records opening logs once while someone keeps reading, and never the lines', async () => {
    const id = await addService('Staging');
    await logs(id, owner, 'since=2026-11-06T11:00:00Z').expect(200);
    await logs(id, owner, 'since=2026-11-06T11:00:00Z').expect(200);
    const events = await auditOf(id);
    expect(events.map(({ action }) => action)).toEqual(['logs.viewed']);
    expect(JSON.stringify(events)).not.toContain('sensitive');
  });

  it('shows a readable message when AWS refuses', async () => {
    read.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'AccessDeniedException' }));
    const { body } = await logs(await addService('Staging')).expect(200);
    expect(body.error).toContain("This key doesn't allow that");
    expect(JSON.stringify(body)).not.toContain('raw aws text');
  });

  it('refuses other resources, other workspaces and bad input', async () => {
    await logs(await addService('Staging', 'ec2-instance')).expect(404);
    const id = await addService('Staging');
    await logs(id, otherOwner).expect(404);
    await logs(id, owner, 'since=nope').expect(400);
  });
});
