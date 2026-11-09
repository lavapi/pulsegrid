import type { SecretView, UserPermission } from '@pulsegrid/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTenantContext } from '../src/database/tenant-context';
import { CredentialVault } from '../src/inventory/connection/credential-vault';
import { awsProvider } from '../src/inventory/providers/aws/aws.provider';
import { CLOUD_PROVIDER_LIST, type CloudProvider, type StoredSecret } from '../src/inventory/providers/provider';
import { setExtraPermissions, signIn, startTestApp, type TestContext, user } from './support/test-app';

const KEY = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'never-shown' };
const SECRET_VALUE = 'super-secret-value';
const read = vi.fn<() => Promise<StoredSecret>>();
const write = vi.fn<(context: unknown, value: string) => Promise<void>>();

const provider: CloudProvider = {
  ...awsProvider,
  actions: [],
  secretStore: { resourceType: 'secrets-manager-secret', read, write },
};

describe('secrets', () => {
  let context: TestContext;
  let owner: string;
  let developer: string;
  let otherOwner: string;
  let sequence = 0;
  const http = () => request(context.app.getHttpServer());

  const addAccount = async (environment: string | null) => {
    const tenantId = context.acme.tenant.id;
    sequence += 1;
    const row = { tenant_id: tenantId, provider: 'aws', account_id: String(200000000000 + sequence) };
    const environmentRow = environment
      ? await context.owner
          .insertInto('environments')
          .values({ tenant_id: tenantId, name: environment, sort_order: sequence })
          .onConflict((conflict) =>
            conflict.columns(['tenant_id', 'name']).doUpdateSet({ sort_order: sequence }),
          )
          .returning('id')
          .executeTakeFirstOrThrow()
      : null;
    const { id } = await context.owner
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
        environment_id: environmentRow?.id ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const addSecret = async (environment: string | null, details: Record<string, unknown> = {}, type = 'secrets-manager-secret') => {
    const { id } = await context.owner
      .insertInto('resources')
      .values({
        tenant_id: context.acme.tenant.id,
        cloud_account_id: await addAccount(environment),
        region: 'eu-central-1',
        type: type as 'secrets-manager-secret',
        service: 'secrets',
        native_id: `arn:secret:${(sequence += 1)}`,
        name: 'app-secrets',
        status: 'active',
        health: 'healthy',
        tags: '{}',
        details: JSON.stringify(details),
        last_seen_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  };

  const view = (id: string, cookie = owner) => http().get(`/api/resources/${id}/secret`).set('Cookie', cookie);
  const reveal = (id: string, key: string | null, cookie = owner) =>
    http().post(`/api/resources/${id}/secret/reveal`).set('Cookie', cookie).send({ key });
  const save = (id: string, key: string | null, value: string, versionId = 'v1', cookie = owner, name = key) =>
    http().put(`/api/resources/${id}/secret/keys`).set('Cookie', cookie).send({ key, name, value, versionId });
  const remove = (id: string, key: string, versionId = 'v1', cookie = owner) =>
    http().post(`/api/resources/${id}/secret/keys/delete`).set('Cookie', cookie).send({ key, versionId });
  const grant = (permissions: UserPermission[]) =>
    setExtraPermissions(context, context.acme, 'developer', permissions);
  const auditOf = (id: string) =>
    context.owner
      .selectFrom('audit_events')
      .select(['action', 'metadata'])
      .where('target_id', '=', id)
      .execute();
  const setTwoFactor = (enabled: boolean) =>
    withTenantContext(context.owner, context.acme.tenant.id, (trx) =>
      trx
        .updateTable('accounts')
        .set({ totp_enabled_at: enabled ? new Date() : null })
        .where('email', '=', 'dev@example.test')
        .execute(),
    );

  beforeAll(async () => {
    context = await startTestApp((builder) =>
      builder.overrideProvider(CLOUD_PROVIDER_LIST).useValue([provider]),
    );
    owner = await signIn(context, context.acme, user('ada', 'admin'));
    developer = await signIn(context, context.acme, user('dev', 'developer'));
    otherOwner = await signIn(context, context.globex, user('gia', 'admin'));
  });
  afterAll(() => context.close());
  beforeEach(async () => {
    read.mockReset();
    read.mockResolvedValue({ value: JSON.stringify({ TOKEN: SECRET_VALUE, PORT: 5432 }), versionId: 'v1' });
    write.mockReset();
    write.mockResolvedValue();
    await setExtraPermissions(context, context.acme, 'developer', []);
    await setTwoFactor(true);
  });

  describe('viewing', () => {
    it('lists key names without any value', async () => {
      const { body, headers } = await view(await addSecret('Staging')).expect(200);
      expect((body as SecretView).content).toEqual({ format: 'keyValue', keys: ['PORT', 'TOKEN'], versionId: 'v1' });
      expect(JSON.stringify(body)).not.toContain(SECRET_VALUE);
      expect(headers['cache-control']).toBe('no-store');
    });

    it('shows a single value secret as text', async () => {
      read.mockResolvedValue({ value: SECRET_VALUE, versionId: 'v1' });
      const id = await addSecret('Staging');
      expect((await view(id).expect(200)).body.content).toEqual({ format: 'text', keys: [], versionId: 'v1' });
      expect((await reveal(id, null).expect(200)).body.value).toBe(SECRET_VALUE);
    });

    it('never calls AWS without access', async () => {
      const id = await addSecret('Staging');
      const { body } = await view(id, developer).expect(200);
      expect(body).toMatchObject({ access: { canRead: false }, content: null });
      expect(read).not.toHaveBeenCalled();
    });

    it('shows a readable message when AWS refuses', async () => {
      read.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'AccessDeniedException' }));
      const { body } = await view(await addSecret('Staging')).expect(200);
      expect(body.error).toContain("This key doesn't allow that");
      expect(JSON.stringify(body)).not.toContain('raw aws text');
    });

    it('refuses other resource types and other workspaces', async () => {
      await view(await addSecret('Staging', {}, 's3-bucket')).expect(404);
      await view(await addSecret('Staging'), otherOwner).expect(404);
    });
  });

  describe('revealing', () => {
    it('returns one value, and records the key but not the value', async () => {
      const id = await addSecret('Staging');
      const { body, headers } = await reveal(id, 'TOKEN').expect(200);
      expect(body).toEqual({ value: SECRET_VALUE });
      expect(headers['cache-control']).toBe('no-store');
      const events = await auditOf(id);
      expect(events.map(({ action }) => action)).toEqual(['secret.value_read']);
      expect(events[0]?.metadata).toMatchObject({ key: 'TOKEN', label: 'app-secrets' });
      expect(JSON.stringify(events)).not.toContain(SECRET_VALUE);
    });

    it('shows non-text values as text', async () => {
      expect((await reveal(await addSecret('Staging'), 'PORT').expect(200)).body.value).toBe('5432');
    });

    it('handles unknown keys', async () => {
      const id = await addSecret('Staging');
      await reveal(id, 'MISSING').expect(404);
      await reveal(id, 'constructor').expect(404);
    });

    it('needs a permission, and records the refusal', async () => {
      const id = await addSecret('Staging');
      await reveal(id, 'TOKEN', developer).expect(403);
      expect(read).not.toHaveBeenCalled();
      expect((await auditOf(id)).map(({ action }) => action)).toEqual(['access.denied']);
      await grant(['secret.read']);
      await reveal(id, 'TOKEN', developer).expect(200);
    });

    it('needs two-factor', async () => {
      await grant(['secret.read']);
      await setTwoFactor(false);
      const response = await reveal(await addSecret('Staging'), 'TOKEN', developer);
      expect(response.status).toBe(403);
      expect(response.body.message).toContain('two-factor');
      expect(read).not.toHaveBeenCalled();
    });

    it.each(['Production', null])('never shows values in %s, even to the owner', async (environment) => {
      const id = await addSecret(environment);
      await reveal(id, 'TOKEN').expect(403);
      expect((await view(id).expect(200)).body.content).toBeNull();
      expect(read).not.toHaveBeenCalled();
    });
  });

  describe('changing', () => {
    it('adds and edits a key, keeping the others', async () => {
      const id = await addSecret('Staging');
      await save(id, null, 'value', 'v1', owner, 'NEW').expect(204);
      expect(JSON.parse(write.mock.calls[0]![1])).toEqual({ TOKEN: SECRET_VALUE, PORT: 5432, NEW: 'value' });
      await save(id, 'TOKEN', 'changed').expect(204);
      expect(JSON.parse(write.mock.calls[1]![1])).toEqual({ TOKEN: 'changed', PORT: 5432 });
      const events = await auditOf(id);
      expect(events.map(({ action }) => action)).toEqual(['secret.key_saved', 'secret.key_saved']);
      expect(JSON.stringify(events)).not.toContain('changed"');
    });

    it('renames a key, and records both names but no value', async () => {
      const id = await addSecret('Staging');
      await save(id, 'TOKEN', SECRET_VALUE, 'v1', owner, 'API_TOKEN').expect(204);
      expect(JSON.parse(write.mock.calls[0]![1])).toEqual({ API_TOKEN: SECRET_VALUE, PORT: 5432 });
      const [event] = await auditOf(id);
      expect(event?.metadata).toMatchObject({ key: 'API_TOKEN', previousKey: 'TOKEN' });
      expect(JSON.stringify(event)).not.toContain(SECRET_VALUE);
    });

    it('keeps number types and refuses a name in use', async () => {
      const id = await addSecret('Staging');
      await save(id, 'PORT', '6000').expect(204);
      expect(JSON.parse(write.mock.calls[0]![1])).toMatchObject({ PORT: 6000 });
      const taken = await save(id, 'PORT', '1', 'v1', owner, 'TOKEN');
      expect(taken.status).toBe(409);
      expect(taken.body.message).toBe('That key already exists. Choose another name.');
    });

    it('refuses broken JSON', async () => {
      read.mockResolvedValue({ value: JSON.stringify({ CONFIG: { a: 1 } }), versionId: 'v1' });
      const response = await save(await addSecret('Staging'), 'CONFIG', '{broken');
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('This value has to stay valid JSON.');
      expect(write).not.toHaveBeenCalled();
    });

    it('replaces a whole secret, and records key names only', async () => {
      const id = await addSecret('Staging');
      const value = JSON.stringify({ TOKEN: 'replacement-value', ADDED: { nested: true } }, null, 2);
      await save(id, null, value).expect(204);
      expect(JSON.parse(write.mock.calls[0]![1])).toEqual({ TOKEN: 'replacement-value', ADDED: { nested: true } });
      const [event] = await auditOf(id);
      expect(event?.metadata).toMatchObject({ added: ['ADDED'], changed: ['TOKEN'], removed: ['PORT'] });
      expect(JSON.stringify(event)).not.toContain('replacement-value');
    });

    it('shows the whole secret', async () => {
      const { body } = await reveal(await addSecret('Staging'), null).expect(200);
      expect(JSON.parse(body.value)).toEqual({ TOKEN: SECRET_VALUE, PORT: 5432 });
    });

    it('refuses a whole secret that is not a JSON object, or is out of date', async () => {
      const id = await addSecret('Staging');
      const broken = await save(id, null, '{broken');
      expect(broken.status).toBe(400);
      expect(broken.body.message).toBe('This secret has to stay a valid JSON object.');
      await save(id, null, '{"a":1}', 'old-version').expect(409);
      expect(write).not.toHaveBeenCalled();
    });

    it('replaces a single value secret', async () => {
      read.mockResolvedValue({ value: 'old', versionId: 'v1' });
      const id = await addSecret('Staging');
      await save(id, null, 'new').expect(204);
      expect(write.mock.calls[0]![1]).toBe('new');
      await save(id, 'KEY', 'new').expect(400);
    });

    it('deletes a key', async () => {
      const id = await addSecret('Staging');
      await remove(id, 'TOKEN').expect(204);
      expect(JSON.parse(write.mock.calls[0]![1])).toEqual({ PORT: 5432 });
      expect((await auditOf(id)).map(({ action }) => action)).toEqual(['secret.key_deleted']);
      await remove(id, 'MISSING').expect(404);
    });

    it('does not overwrite a newer version', async () => {
      const id = await addSecret('Staging');
      const response = await save(id, 'TOKEN', 'x', 'old-version');
      expect(response.status).toBe(409);
      expect(response.body.message).toContain('changed since you opened it');
      await remove(id, 'TOKEN', 'old-version').expect(409);
      expect(write).not.toHaveBeenCalled();
    });

    it('needs the write permission', async () => {
      const id = await addSecret('Staging');
      await grant(['secret.read']);
      await save(id, 'TOKEN', 'x', 'v1', developer).expect(403);
      await remove(id, 'TOKEN', 'v1', developer).expect(403);
      expect(write).not.toHaveBeenCalled();
      await grant(['secret.write']);
      await save(id, 'TOKEN', 'x', 'v1', developer).expect(204);
    });

    it('never changes production, even for the owner', async () => {
      const id = await addSecret('Production');
      await save(id, 'TOKEN', 'x').expect(403);
      await remove(id, 'TOKEN').expect(403);
      expect(write).not.toHaveBeenCalled();
    });

    it('leaves a secret AWS manages alone', async () => {
      const id = await addSecret('Staging', { managedBy: 'rds' });
      const response = await save(id, 'TOKEN', 'x');
      expect(response.status).toBe(403);
      expect(response.body.message).toContain('AWS manages');
    });

    it('refuses binary secrets and bad input', async () => {
      read.mockResolvedValue({ value: null, versionId: 'v1' });
      const id = await addSecret('Staging');
      await save(id, null, 'x').expect(400);
      await save(id, 'bad\nkey', 'x').expect(400);
      await save(id, 'KEY', 'x'.repeat(65_537)).expect(400);
      expect(write).not.toHaveBeenCalled();
    });

    it('shows a readable message when the write fails', async () => {
      write.mockRejectedValue(Object.assign(new Error('raw aws text'), { name: 'AccessDeniedException' }));
      const response = await save(await addSecret('Staging'), 'TOKEN', 'x');
      expect(response.status).toBe(400);
      expect(response.body.message).toContain("This key doesn't allow that");
    });
  });
});
