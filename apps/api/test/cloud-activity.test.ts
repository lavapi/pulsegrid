import type { CloudActivityPage } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import { type ActivityResult, CLOUD_PROVIDER_LIST, type CloudProvider } from '../src/inventory/providers/provider';
import { signIn, startTestApp, type TestContext, user } from './support/test-app';

const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'never-shown' };
const read = vi.fn<(context: unknown, query: unknown) => Promise<ActivityResult>>();
const provider: CloudProvider = { ...awsProvider, activitySource: { read } };

describe('AWS activity', () => {
  let context: TestContext;
  let admin: string;
  let viewer: string;
  let other: string;
  let accountId: string;
  const http = () => request(context.app.getHttpServer());
  const activity = (id: string, cookie = admin, query = '') =>
    http().get(`/api/cloud/accounts/${id}/activity${query}`).set('Cookie', cookie);

  beforeAll(async () => {
    context = await startTestApp((builder) => builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]));
    admin = await signIn(context, context.acme, user('ada', 'admin'));
    viewer = await signIn(context, context.acme, user('val', 'viewer'));
    other = await signIn(context, context.globex, user('gia', 'admin'));
    const row = { tenant_id: context.acme.tenant.id, provider: 'aws', account_id: '500000000000' };
    ({ id: accountId } = await context.owner
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
        environment_id: null,
      })
      .returning('id')
      .executeTakeFirstOrThrow());
  });
  afterAll(() => context.close());
  beforeEach(() => {
    read.mockReset();
    read.mockResolvedValue({ events: [], before: null });
  });

  it('passes filters and the key to the provider', async () => {
    await activity(accountId, admin, '?actor=alex&resource=i-1&reads=true').expect(200);
    expect(read).toHaveBeenCalledWith(
      { credentials: KEY, regions: ['eu-central-1'] },
      expect.objectContaining({ actor: 'alex', resource: 'i-1', includeReads: true }),
    );
  });

  it('is for Admins in the same workspace', async () => {
    await activity(accountId, viewer).expect(403);
    await activity(accountId, other).expect(404);
    expect(read).not.toHaveBeenCalled();
  });

  it('shows a readable message when AWS refuses', async () => {
    read.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'AccessDeniedException' }));
    const { body } = (await activity(accountId).expect(200)) as { body: CloudActivityPage };
    expect(body.error).toContain("This key doesn't allow that");
    expect(JSON.stringify(body)).not.toContain('raw aws text');
  });
});
