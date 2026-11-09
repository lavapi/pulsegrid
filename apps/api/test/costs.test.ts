import type { CostOverview } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { CostRefreshService } from '../src/inventory/costs/cost-refresh.service';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import { CLOUD_PROVIDER_LIST, type CloudProvider, type CostEntry } from '../src/inventory/providers/provider';
import {
  setExtraPermissions,
  signIn,
  startTestApp,
  type TestContext,
  type TestTenant,
  user,
} from './support/test-app';

const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'never-shown' };
const read = vi.fn<(context: unknown, period: unknown) => Promise<CostEntry[]>>();
const provider: CloudProvider = {
  ...awsProvider,
  costSource: { read, failureMessage: () => "This key can't read costs." },
};
const month = new Date().toISOString().slice(0, 7);
const entry = (service: string, amount: number, category: string | null = null): CostEntry => ({
  month,
  service,
  category,
  amount,
  currency: 'USD',
});

describe('costs', () => {
  let context: TestContext;
  let superAdmin: string;
  let admin: string;
  let developer: string;
  let viewer: string;
  let other: string;
  let accountId: string;
  const costs = (cookie: string) => request(context.app.getHttpServer()).get('/api/costs').set('Cookie', cookie);
  const refresh = () => context.app.get(CostRefreshService);
  const overview = async (cookie = admin) => ((await costs(cookie).expect(200)) as { body: CostOverview }).body;

  const addAccount = async ({ tenant }: TestTenant, cloudAccount: string): Promise<string> => {
    const row = { tenant_id: tenant.id, provider: 'aws', account_id: cloudAccount };
    const { id } = await context.owner
      .insertInto('cloud_accounts')
      .values({
        ...row,
        name: `Account ${cloudAccount}`,
        status: 'connected',
        regions: ['eu-central-1'],
        encrypted_credentials: context.app.get(CredentialVault).seal(row, KEY),
        credential_hint: null,
        can_write: false,
        last_error: null,
        last_synced_at: null,
        environment_id: null,
        costs_checked_at: null,
        costs_updated_at: null,
        costs_error: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]),
    );
    superAdmin = await signIn(context, context.acme, user('sue', 'admin'));
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    developer = await signIn(context, context.acme, user('dev', 'developer'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    other = await signIn(context, context.globex, user('gia', 'admin'));
    accountId = await addAccount(context.acme, '500000000000');
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    read.mockReset();
    await context.owner.deleteFrom('cloud_costs').execute();
    await context.owner
      .updateTable('cloud_accounts')
      .set({ costs_checked_at: null, costs_updated_at: null, costs_error: null })
      .execute();
  });

  it('is for the super admin and Admins only', async () => {
    await costs(superAdmin).expect(200);
    await costs(admin).expect(200);
    await costs(developer).expect(403);
    await costs(viewer).expect(403);
  });

  it('can be given to another role', async () => {
    await setExtraPermissions(context, context.acme, 'viewer', ['costs.view']);
    await costs(viewer).expect(200);
    await setExtraPermissions(context, context.acme, 'viewer', []);
    await costs(viewer).expect(403);
  });

  it('saves what the provider reports and shows the biggest first', async () => {
    read.mockResolvedValue([entry('S3', 2, 's3'), entry('EC2', 12.5, 'ec2')]);
    await refresh().refreshDueAccounts();

    expect(read).toHaveBeenCalledWith(
      { credentials: KEY, accountId: '500000000000' },
      expect.objectContaining({ from: expect.any(Date), until: expect.any(Date) }),
    );
    const [account] = (await overview()).accounts;
    expect(account).toMatchObject({ accountId, currency: 'USD', error: null });
    expect(account!.services).toEqual([
      { service: 'EC2', category: 'ec2', thisMonth: 12.5, lastMonth: 0 },
      { service: 'S3', category: 's3', thisMonth: 2, lastMonth: 0 },
    ]);
  });

  it('only calls the provider again once the figures are old', async () => {
    read.mockResolvedValue([entry('EC2', 1)]);
    const start = new Date();
    await refresh().refreshDueAccounts(start);
    await refresh().refreshDueAccounts(new Date(start.getTime() + 60 * 60 * 1000));
    expect(read).toHaveBeenCalledTimes(1);
    await refresh().refreshDueAccounts(new Date(start.getTime() + 6 * 60 * 60 * 1000));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('replaces figures, dropping services no longer billed', async () => {
    read.mockResolvedValueOnce([entry('EC2', 1), entry('S3', 1)]).mockResolvedValueOnce([entry('EC2', 2)]);
    const start = new Date();
    await refresh().refreshDueAccounts(start);
    await refresh().refreshDueAccounts(new Date(start.getTime() + 6 * 60 * 60 * 1000));
    const [account] = (await overview()).accounts;
    expect(account!.services.map(({ service, thisMonth }) => [service, thisMonth])).toEqual([['EC2', 2]]);
  });

  it('keeps the last figures and a readable message when reading fails', async () => {
    read.mockResolvedValueOnce([entry('EC2', 1)]);
    const start = new Date();
    await refresh().refreshDueAccounts(start);
    read.mockRejectedValueOnce(new Error('raw aws text'));
    await refresh().refreshDueAccounts(new Date(start.getTime() + 6 * 60 * 60 * 1000));

    const body = await overview();
    expect(body.accounts[0]).toMatchObject({ error: "This key can't read costs." });
    expect(body.accounts[0]!.services).toHaveLength(1);
    expect(body.accounts[0]!.updatedAt).toBe(start.toISOString());
    expect(JSON.stringify(body)).not.toContain('raw aws text');
  });

  it('stays inside the workspace', async () => {
    read.mockResolvedValue([entry('EC2', 1)]);
    await refresh().refreshDueAccounts();
    expect((await overview(other)).accounts).toEqual([]);
  });
});
