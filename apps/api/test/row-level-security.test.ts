import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/connection';
import type { Database } from '../src/database/schema';
import { withTenantContext } from '../src/database/tenant-context';
import { appUrl, startTestApp, type TestContext } from './support/test-app';

describe('row-level security for the runtime role', () => {
  let context: TestContext;
  let app: Kysely<Database>;

  beforeAll(async () => {
    context = await startTestApp();
    app = createDatabase(appUrl);
  });
  afterAll(async () => {
    await app.destroy();
    await context.close();
  });

  beforeAll(async () => {
    await context.owner
      .insertInto('environments')
      .values([
        { tenant_id: context.acme.tenant.id, name: 'Staging' },
        { tenant_id: context.globex.tenant.id, name: 'Staging' },
      ])
      .execute();
  });

  it('sees nothing without a tenant context', async () => {
    expect(await app.selectFrom('environments').selectAll().execute()).toEqual([]);
    expect(await app.selectFrom('users').selectAll().execute()).toEqual([]);
  });

  it('sees only the current tenant', async () => {
    const { id } = context.acme.tenant;
    const rows = await withTenantContext(app, id, (trx) =>
      trx.selectFrom('environments').selectAll().execute(),
    );
    expect(rows.map((row) => row.tenant_id)).toEqual([id]);
  });

  it('does not leak the tenant context to the next query', async () => {
    await withTenantContext(app, context.acme.tenant.id, async () => undefined);
    expect(await app.selectFrom('environments').selectAll().execute()).toEqual([]);
  });

  it('cannot write a row for another tenant', async () => {
    const write = withTenantContext(app, context.acme.tenant.id, (trx) =>
      trx
        .insertInto('environments')
        .values({ tenant_id: context.globex.tenant.id, name: 'Intruder' })
        .execute(),
    );
    await expect(write).rejects.toThrow(/row-level security/);
  });

  it('cannot change or delete audit events', async () => {
    await expect(sql`update audit_events set action = 'x'`.execute(app)).rejects.toThrow(/permission denied/);
    await expect(sql`delete from audit_events`.execute(app)).rejects.toThrow(/permission denied/);
  });

  it('cannot change or delete tenants', async () => {
    await expect(sql`update tenants set name = 'x'`.execute(app)).rejects.toThrow(/permission denied/);
    await expect(sql`delete from tenants`.execute(app)).rejects.toThrow(/permission denied/);
  });
});
