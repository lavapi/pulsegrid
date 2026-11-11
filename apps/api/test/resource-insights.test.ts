import type { RequestLogEntry } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { newEnvironment } from '../src/inventory/environments/account-environment';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import {
  CLOUD_PROVIDER_LIST,
  type CloudProvider,
  type DatabaseActivitySource,
  LogsUnreadable,
  type RequestLogSource,
} from '../src/inventory/providers/provider';
import { setExtraPermissions, signIn, startTestApp, type TestContext, user } from './support/test-app';

const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'never-shown' };
const ENTRY: RequestLogEntry = {
  time: '2026-11-11T10:00:00.000000Z',
  host: 'api.example.com',
  method: 'GET',
  path: '/v1/players?email=a@example.com',
  elbStatus: 502,
  targetStatus: 502,
  responseMs: 120,
  service: 'game-api',
  userAgent: 'okhttp',
  edgeIp: '172.70.1.9',
  protocol: 'HTTP/2.0',
};

const requestSource = {
  resourceType: 'load-balancer' as const,
  requests: vi.fn<RequestLogSource['requests']>(),
  scanRequests: vi.fn<RequestLogSource['scanRequests']>(),
  connections: vi.fn<RequestLogSource['connections']>(),
};
const databaseSource = {
  resourceTypes: ['rds-cluster', 'rds-instance'] as const,
  topSql: vi.fn<DatabaseActivitySource['topSql']>(),
  log: vi.fn<DatabaseActivitySource['log']>(),
};
const provider: CloudProvider = {
  ...awsProvider,
  actions: [],
  requestLogSource: requestSource,
  databaseActivitySource: databaseSource,
};

describe('request logs and query activity', () => {
  let context: TestContext;
  let developer: string;
  let otherOwner: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const range = () => `from=${encodeURIComponent(minutesAgo(15))}&to=${encodeURIComponent(minutesAgo(0))}`;

  const addResource = async (type: 'load-balancer' | 'rds-cluster' | 'ecs-service') => {
    const tenantId = context.acme.tenant.id;
    sequence += 1;
    const row = { tenant_id: tenantId, provider: 'aws', account_id: String(500000000000 + sequence) };
    const { id: environmentId } = await context.owner
      .insertInto('environments')
      .values(newEnvironment(tenantId, 'Production', sequence))
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
        type,
        service: 'x',
        native_id: `arn:${sequence}`,
        name: 'game',
        status: 'ok',
        health: 'healthy',
        tags: '{}',
        details: JSON.stringify({ engine: 'aurora-postgresql' }),
        last_seen_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { id, awsAccount: row.account_id };
  };

  const get = (path: string, cookie = developer) => http().get(`/api/resources/${path}`).set('Cookie', cookie);
  const allow = (...permissions: ('logs.read' | 'logs.sensitive')[]) =>
    setExtraPermissions(context, context.acme, 'developer', permissions);

  beforeAll(async () => {
    context = await startTestApp((builder) => builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]));
    developer = await signIn(context, context.acme, user('dev', 'developer'));
    otherOwner = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    vi.clearAllMocks();
    requestSource.requests.mockResolvedValue({ entries: [ENTRY], older: 'next' });
    requestSource.scanRequests.mockImplementation(async (_context, { matches }, visit) => {
      if (matches(ENTRY)) {
        visit(ENTRY);
      }
      return { partial: false };
    });
    requestSource.connections.mockResolvedValue({ entries: [], older: null });
    databaseSource.topSql.mockResolvedValue([]);
    databaseSource.log.mockImplementation(async (_context, { level }) => ({
      lines: [
        {
          id: level,
          time: '2026-11-11T10:00:00.000Z',
          instance: 'game-1',
          message:
            level === 'slow'
              ? "2026-11-11 10:00:00 UTC:10.0.0.5(1):app@game:[1]:LOG:  duration: 1500.5 ms  statement: SELECT * FROM players WHERE email = 'a@example.com'"
              : '2026-11-11 10:00:00 UTC:10.0.0.5(1):app@game:[1]:ERROR:  duplicate key value violates unique constraint "players_email_key"',
        },
      ],
      partial: false,
    }));
    await allow('logs.read');
  });

  it('lists requests without query strings, and passes the filter on', async () => {
    const { id, awsAccount } = await addResource('load-balancer');
    const { body, headers } = await get(`${id}/request-log?${range()}&status=5xx&path=players`).expect(200);
    expect(body).toMatchObject({ access: { allowed: true }, problem: null, older: 'next', canShowQuery: false });
    expect(body.entries[0].path).toBe('/v1/players');
    expect(headers['cache-control']).toBe('no-store');
    const [readContext, query] = requestSource.requests.mock.calls[0] ?? [];
    expect(readContext).toMatchObject({ accountId: awsAccount, region: 'eu-central-1' });
    expect(query?.limit).toBe(100);
    expect(query?.matches(ENTRY)).toBe(true);
    expect(query?.matches({ ...ENTRY, elbStatus: 200 })).toBe(false);
  });

  it('shows query strings only to people allowed to see them', async () => {
    const { id } = await addResource('load-balancer');
    expect((await get(`${id}/request-log?${range()}&showQuery=true`).expect(200)).body.entries[0].path).toBe('/v1/players');
    await allow('logs.read', 'logs.sensitive');
    const { body } = await get(`${id}/request-log?${range()}&showQuery=true`).expect(200);
    expect(body).toMatchObject({ canShowQuery: true });
    expect(body.entries[0].path).toBe('/v1/players?email=a@example.com');
  });

  it('sums up the range', async () => {
    const { id } = await addResource('load-balancer');
    const { body } = await get(`${id}/request-log/summary?${range()}`).expect(200);
    expect(body).toMatchObject({ requests: 1, errorRate: 1, noTarget: 0, partial: false, topPaths: [{ key: '/v1/players', count: 1 }] });
  });

  it('passes on why the logs are unreadable, with the identity to grant', async () => {
    const { id } = await addResource('load-balancer');
    const problem = { message: "ALB logs aren't readable yet", principal: 'arn:aws:iam::1:user/pulsegrid' };
    requestSource.requests.mockRejectedValue(new LogsUnreadable(problem));
    expect((await get(`${id}/request-log?${range()}`).expect(200)).body).toMatchObject({ problem, entries: [] });
    requestSource.requests.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'ThrottlingException' }));
    const { body } = await get(`${id}/request-log?${range()}`).expect(200);
    expect(body.problem.message).toBe('AWS asked PulseGrid to slow down. Try again in a moment.');
    expect(JSON.stringify(body)).not.toContain('raw aws text');
  });

  it('refuses ranges over 24 hours, outside the logs, or in the wrong order', async () => {
    const { id } = await addResource('load-balancer');
    const span = (from: number, to: number) =>
      get(`${id}/request-log?from=${encodeURIComponent(minutesAgo(from))}&to=${encodeURIComponent(minutesAgo(to))}`);
    expect((await span(25 * 60, 0).expect(400)).body.message).toBe(
      'Choose a time range of up to 24 hours within the last 90 days.',
    );
    await span(91 * 24 * 60, 91 * 24 * 60 - 10).expect(400);
    await span(0, 15).expect(400);
    await get(`${id}/request-log?${range()}&status=6xx`).expect(400);
    expect(requestSource.requests).not.toHaveBeenCalled();
  });

  it('needs View logs, works only on load balancers and databases, and keeps other workspaces out', async () => {
    const { id } = await addResource('load-balancer');
    await allow();
    const { body } = await get(`${id}/request-log?${range()}`).expect(200);
    expect(body.access).toEqual({ allowed: false, reason: 'Ask your super admin for the View logs permission.' });
    expect(requestSource.requests).not.toHaveBeenCalled();
    await allow('logs.read');
    await get(`${(await addResource('ecs-service')).id}/request-log?${range()}`).expect(404);
    await get(`${id}/top-sql?range=1h`).expect(404);
    await get(`${id}/request-log?${range()}`, otherOwner).expect(404);
  });

  it('shows top SQL for the chosen range', async () => {
    const { id } = await addResource('rds-cluster');
    await get(`${id}/top-sql?range=7d`).expect(200, { access: { allowed: true, reason: null }, problem: null, instances: [] });
    const [, since, until] = databaseSource.topSql.mock.calls[0] ?? [];
    expect((until?.getTime() ?? 0) - (since?.getTime() ?? 0)).toBe(7 * 24 * 60 * 60_000);
    await get(`${id}/top-sql?range=2y`).expect(400);
  });

  it('shows the database log and slow queries, with values hidden unless allowed', async () => {
    const { id } = await addResource('rds-cluster');
    const path = `${id}/database-log?since=${encodeURIComponent(minutesAgo(60))}&level=errors`;
    const { body } = await get(path).expect(200);
    expect(body.lines).toEqual([
      {
        id: 'errors',
        time: '2026-11-11T10:00:00.000Z',
        instance: 'game-1',
        severity: 'ERROR',
        message: '10.0.0.5(1):app@game duplicate key value violates unique constraint "players_email_key"',
      },
    ]);
    expect(body.slowQueries).toEqual([
      {
        id: 'slow',
        time: '2026-11-11T10:00:00.000Z',
        instance: 'game-1',
        durationMs: 1500.5,
        statement: "SELECT * FROM players WHERE email = '?'",
      },
    ]);
    expect(body.showsValues).toBe(false);
    expect(databaseSource.log.mock.calls.map(([, query]) => query.level).sort()).toEqual(['errors', 'slow']);
    await allow('logs.read', 'logs.sensitive');
    expect((await get(path).expect(200)).body.slowQueries[0].statement).toContain('a@example.com');
    expect((await get(`${path}&search=nothing-like-this`).expect(200)).body.lines).toEqual([]);
    await get(`${id}/database-log?since=nope`).expect(400);
  });
});
