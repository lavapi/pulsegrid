import type { ResourceType } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { newEnvironment } from '../src/inventory/environments/account-environment';
import { AWS_METRIC_SOURCE } from '../src/inventory/providers/aws/aws-metrics';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import {
  CLOUD_PROVIDER_LIST,
  type CloudProvider,
  type LatestMetricsContext,
  type MetricContext,
  type MetricQuery,
  type MetricResult,
} from '../src/inventory/providers/provider';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'never-shown' };
const RESULT: MetricResult = {
  charts: [
    {
      id: 'cpu',
      label: 'CPU',
      unit: 'percent',
      limit: 100,
      warnAbove: 80,
      total: null,
      note: null,
      series: [{ label: 'db', points: [{ timestamp: '2026-11-10T12:00:00.000Z', value: 42 }] }],
    },
  ],
  capacity: [{ label: 'Instance class', value: 'db.t4g.medium' }],
  hiddenSeries: 0,
};
const read = vi.fn<(context: MetricContext, query: MetricQuery) => Promise<MetricResult>>();
const readLatest = vi.fn<
  (context: LatestMetricsContext, chartIds: (type: ResourceType) => readonly string[]) => Promise<(MetricResult | null)[]>
>();
const provider: CloudProvider = {
  ...awsProvider,
  actions: [],
  metricSource: { ...AWS_METRIC_SOURCE, read, readLatest } as CloudProvider['metricSource'],
};

describe('resource load', () => {
  let context: TestContext;
  let viewer: string;
  let otherOwner: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());

  const addResource = async (environment: string, type: string, sealed = true) => {
    const tenantId = context.acme.tenant.id;
    sequence += 1;
    const row = { tenant_id: tenantId, provider: 'aws', account_id: String(500000000000 + sequence) };
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
        encrypted_credentials: sealed ? context.app.get(CredentialVault).seal(row, KEY) : null,
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
        type: type as 'rds-instance',
        service: 'rds',
        native_id: `arn:${sequence}`,
        name: 'db',
        status: 'available',
        health: 'healthy',
        tags: '{}',
        details: JSON.stringify({ instanceClass: 'db.t4g.medium' }),
        last_seen_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const load = (id: string, cookie = viewer, query = 'range=1h') =>
    http().get(`/api/resources/${id}/load?${query}`).set('Cookie', cookie);

  beforeAll(async () => {
    context = await startTestApp((builder) => builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    otherOwner = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(() => {
    read.mockReset();
    read.mockResolvedValue(RESULT);
    readLatest.mockReset();
    readLatest.mockImplementation(async ({ resources }) => resources.map(() => RESULT));
  });

  it('shows load to everyone, in production too, for the chosen range', async () => {
    const before = Date.now();
    const { body, headers } = await load(await addResource('Production', 'rds-instance'), viewer, 'range=24h').expect(200);
    expect(body).toEqual({ available: true, ...RESULT, error: null });
    expect(headers['cache-control']).toBe('no-store');
    const [metricContext, query] = read.mock.calls[0]!;
    expect(metricContext.resource).toMatchObject({ type: 'rds-instance', name: 'db' });
    expect(query.periodSeconds).toBe(300);
    expect(query.until.getTime() - query.since.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(query.until.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('reads a fixed window, such as a failover test, with points that fit its length', async () => {
    const id = await addResource('Staging', 'rds-instance');
    const from = new Date(Date.now() - 50 * 60_000).toISOString();
    const to = new Date(Date.now() - 10 * 60_000).toISOString();
    await load(id, viewer, `from=${from}&to=${to}`).expect(200);
    const [, query] = read.mock.calls[0]!;
    expect(query).toEqual({ since: new Date(from), until: new Date(to), periodSeconds: 60 });
    await load(id, viewer, `from=${to}&to=${from}`).expect(400);
    const weekAgo = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
    await load(id, viewer, `from=${weekAgo}&to=${to}`).expect(400);
  });

  it('says when the account has no access key', async () => {
    const { body } = await load(await addResource('Staging', 'rds-instance', false)).expect(200);
    expect(body.error).toBe('This account has no access key. Add one under Integrations.');
    expect(read).not.toHaveBeenCalled();
  });

  it('explains a missing permission without showing the AWS error', async () => {
    read.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'AccessDenied' }));
    const { body } = await load(await addResource('Staging', 'elasticache-cluster')).expect(200);
    expect(body.error).toBe("This key can't read load. Add cloudwatch:GetMetricData to its IAM policy.");
    expect(JSON.stringify(body)).not.toContain('raw aws text');
  });

  it('refuses other resources, other projects and unknown ranges', async () => {
    await load(await addResource('Staging', 's3-bucket')).expect(404);
    const id = await addResource('Staging', 'rds-cluster');
    await load(id, otherOwner).expect(404);
    const invalid = await load(id, viewer, 'range=1y');
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe('Choose a time range for the load.');
  });

  describe('card load', () => {
    const cards = (ids: string[], cookie = viewer) =>
      http().get(`/api/resources/card-load?ids=${ids.join(',')}`).set('Cookie', cookie);
    const inSameAccount = async (first: string, ...others: string[]) => {
      const { cloud_account_id: accountId } = await context.owner
        .selectFrom('resources')
        .select('cloud_account_id')
        .where('id', '=', first)
        .executeTakeFirstOrThrow();
      await context.owner.updateTable('resources').set({ cloud_account_id: accountId }).where('id', 'in', others).execute();
    };

    it('reads the latest load of many cards together, once per account and region', async () => {
      const [first, second, cluster] = [
        await addResource('Staging', 'rds-instance'),
        await addResource('Staging', 'ecs-service'),
        await addResource('Staging', 'rds-cluster'),
      ];
      await inSameAccount(first, second, cluster);

      const { body, headers } = await cards([first, second, cluster]).expect(200);
      expect(body).toEqual({ [first]: RESULT.charts, [second]: RESULT.charts });
      expect(headers['cache-control']).toBe('no-store');
      expect(readLatest).toHaveBeenCalledTimes(1);
      const [batch, chartIds] = readLatest.mock.calls[0]!;
      expect(batch.resources.map(({ type }) => type).sort()).toEqual(['ecs-service', 'rds-instance']);
      expect(chartIds('ecs-service')).toEqual(['cpu', 'memory']);
      expect(chartIds('elasticache-cluster')).toEqual(['engine-cpu', 'memory', 'memory-share', 'evictions']);
    });

    it('keeps the answer for a minute, so refreshes and other people cost no extra read', async () => {
      const id = await addResource('Staging', 'elasticache-cluster');
      await cards([id]).expect(200);
      await cards([id]).expect(200);
      expect(readLatest).toHaveBeenCalledTimes(1);
    });

    it('leaves out cards it could not read, without showing why', async () => {
      const failing = await addResource('Staging', 'rds-instance');
      const noKey = await addResource('Staging', 'rds-instance', false);
      readLatest.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'AccessDenied' }));
      const { body } = await cards([failing, noKey]).expect(200);
      expect(body).toEqual({});
    });

    it("never reads another project's resources, and checks what it is asked", async () => {
      const id = await addResource('Staging', 'rds-instance');
      expect((await cards([id], otherOwner).expect(200)).body).toEqual({});
      await cards(['not-an-id']).expect(400);
      await cards(Array.from({ length: 101 }, () => crypto.randomUUID())).expect(400);
    });
  });
});
