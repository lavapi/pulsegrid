import 'reflect-metadata';
import type { UserPermission } from '@pulsegrid/shared';
import type { Provider } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Kysely } from 'kysely';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { InventoryCoreModule } from '../../src/inventory/inventory-core.module';
import { GOOGLE_OAUTH, type GoogleOAuth, type GoogleProfile } from '../../src/auth/google/google-oauth';
import { LEAKED_PASSWORDS } from '../../src/auth/passwords/leaked-passwords';
import { hashPassword } from '../../src/auth/passwords/password-hasher';
import { encodeSessionCookie, SESSION_COOKIE } from '../../src/auth/session/session-cookie';
import { SessionService } from '../../src/auth/session/session.service';
import { configureApp } from '../../src/configure-app';
import { createDatabase } from '../../src/database/connection';
import { runMigrations } from '../../src/database/migrate';
import type { Database, Tenant } from '../../src/database/schema';
import { type TenantTransaction, withTenantContext } from '../../src/database/tenant-context';
import { addDefaultRoles, DEFAULT_ROLES } from '../../src/team/default-roles';

const TEST_DATABASE = 'devdash_test';
const ROLE_PASSWORD = 'devdash_app_local';
const HOST = 'localhost:5432';
const PUBLIC_URL = 'http://localhost:3000';
export const LEAKED_PASSWORD = 'password-from-a-breach';
export const ownerUrl = (database: string) => `postgres://devdash_owner:devdash_owner_local@${HOST}/${database}`;
export const appUrl = `postgres://devdash_app:${ROLE_PASSWORD}@${HOST}/${TEST_DATABASE}`;

export type TestRole = 'viewer' | 'developer' | 'admin';

export interface TestTenant {
  tenant: Tenant;
}

export interface TestUser {
  email: string;
  name: string;
  role: TestRole;
}

export interface TestContext {
  app: NestExpressApplication;
  owner: Kysely<Database>;
  acme: TestTenant;
  globex: TestTenant;
  google: { profile: GoogleProfile | null };
  close(): Promise<void>;
}

const recreateDatabase = async (): Promise<void> => {
  const client = new Client({ connectionString: ownerUrl('devdash') });
  await client.connect();
  await client.query(`drop database if exists ${TEST_DATABASE} with (force)`);
  await client.query(`create database ${TEST_DATABASE}`);
  await client.end();
};

const addTenant = async (db: Kysely<Database>, slug: string): Promise<TestTenant> => {
  const tenant = await db
    .insertInto('tenants')
    .values({ slug, name: slug.toUpperCase() })
    .returningAll()
    .executeTakeFirstOrThrow();
  await withTenantContext(db, tenant.id, (trx) => addDefaultRoles(trx, tenant.id));
  return { tenant };
};

const startingRole = (role: TestRole) => role[0]!.toUpperCase() + role.slice(1);

const roleIdIn = async (trx: TenantTransaction, tenantId: string, role: TestRole): Promise<string> =>
  (
    await trx
      .selectFrom('roles')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('name', '=', startingRole(role))
      .executeTakeFirstOrThrow()
  ).id;

export const roleId = (context: TestContext, { tenant }: TestTenant, role: TestRole): Promise<string> =>
  withTenantContext(context.owner, tenant.id, (trx) => roleIdIn(trx, tenant.id, role));

export const setExtraPermissions = (
  context: TestContext,
  { tenant }: TestTenant,
  role: TestRole,
  extras: UserPermission[],
): Promise<void> =>
  withTenantContext(context.owner, tenant.id, async (trx) => {
    const id = await roleIdIn(trx, tenant.id, role);
    const starting = DEFAULT_ROLES.find(({ name }) => name === startingRole(role))?.permissions ?? [];
    await trx.deleteFrom('role_permissions').where('role_id', '=', id).execute();
    const permissions = [...new Set([...starting, ...extras])];
    if (permissions.length > 0) {
      await trx
        .insertInto('role_permissions')
        .values(permissions.map((permission) => ({ tenant_id: tenant.id, role_id: id, permission })))
        .execute();
    }
  });

export const startTestApp = async (
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
  providers: Provider[] = [],
): Promise<TestContext> => {
  await recreateDatabase();
  const owner = createDatabase(ownerUrl(TEST_DATABASE));
  await runMigrations(owner, ROLE_PASSWORD);
  const [acme, globex] = [await addTenant(owner, 'acme'), await addTenant(owner, 'globex')];

  Object.assign(process.env, {
    PUBLIC_URL,
    DATABASE_URL: appUrl,
    REDIS_URL: 'redis://localhost:6379/1',
    SESSION_TTL_HOURS: '8',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });

  const google: TestContext['google'] = { profile: null };
  const fakeGoogle: GoogleOAuth = {
    authorizeUrl: (state) => `https://google.test/auth?state=${state}`,
    profileFor: async () => {
      if (!google.profile) {
        throw new Error('Google refused.');
      }
      return google.profile;
    },
  };
  const base = Test.createTestingModule({ imports: [AppModule, InventoryCoreModule], providers })
    .overrideProvider(LEAKED_PASSWORDS)
    .useValue({ isLeaked: async (password: string) => password === LEAKED_PASSWORD })
    .overrideProvider(GOOGLE_OAUTH)
    .useValue(fakeGoogle)
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true });
  const moduleRef = await customize(base).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();

  return {
    app,
    owner,
    acme,
    globex,
    google,
    close: async () => {
      await app.close();
      await owner.destroy();
    },
  };
};

export const user = (id: string, role: TestRole): TestUser => ({
  email: `${id}@example.test`,
  name: id,
  role,
});

const findOrCreateAccount = async (
  db: Kysely<Database>,
  { email, name, role }: TestUser,
  values: { password_hash?: string; totp_enabled_at?: Date },
) => {
  const existing = await db.selectFrom('accounts').selectAll().where('email', '=', email).executeTakeFirst();
  if (existing) {
    return existing;
  }
  const superAdmin = await db.selectFrom('accounts').select('id').where('is_super_admin', '=', true).executeTakeFirst();
  return db
    .insertInto('accounts')
    .values({ email, display_name: name, is_super_admin: role === 'admin' && !superAdmin, ...values })
    .returningAll()
    .executeTakeFirstOrThrow();
};

const joinProject = (
  db: Kysely<Database>,
  tenantId: string,
  accountId: string,
  { email, name, role }: TestUser,
): Promise<string> =>
  withTenantContext(db, tenantId, async (trx) => {
    const existing = await trx
      .selectFrom('users')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    if (existing) {
      return existing.id;
    }
    const { id } = await trx
      .insertInto('users')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        role_id: await roleIdIn(trx, tenantId, role),
        email,
        display_name: name,
        last_login_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return id;
  });

export const addPerson = async (
  context: TestContext,
  { tenant }: TestTenant,
  person: TestUser,
  password: string,
): Promise<void> => {
  const account = await findOrCreateAccount(context.owner, person, { password_hash: await hashPassword(password) });
  await joinProject(context.owner, tenant.id, account.id, person);
};

export const signIn = async (
  context: TestContext,
  { tenant }: TestTenant,
  person: TestUser,
): Promise<string> => {
  const account = await findOrCreateAccount(context.owner, person, { totp_enabled_at: new Date() });
  await joinProject(context.owner, tenant.id, account.id, person);
  const token = await context.app.get(SessionService).create(account.id, tenant.id);
  return `${SESSION_COOKIE}=${encodeSessionCookie(token)}`;
};
