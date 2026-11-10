import { randomBytes } from 'node:crypto';
import type { Account, Tenant } from '../database/schema';
import { applyTenantContext, type TenantTransaction } from '../database/tenant-context';
import { newEnvironment } from '../inventory/environments/account-environment';
import { ADMIN_ROLE, addDefaultRoles } from '../team/default-roles';

const SLUG_LIMIT = 30;
const DEFAULT_ENVIRONMENTS = ['Staging', 'Production'];

type Seat = Pick<Account, 'id' | 'email' | 'display_name'>;

const slugFor = (name: string): string => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_LIMIT)
    .replace(/-+$/, '');
  return `${base || 'project'}-${randomBytes(3).toString('hex')}`;
};

export const addSeat = async (trx: TenantTransaction, tenantId: string, account: Seat): Promise<string> => {
  const existing = await trx
    .selectFrom('users')
    .select('id')
    .where('account_id', '=', account.id)
    .executeTakeFirst();
  if (existing) {
    return existing.id;
  }
  const role = await trx.selectFrom('roles').select('id').where('name', '=', ADMIN_ROLE).executeTakeFirstOrThrow();
  const { id } = await trx
    .insertInto('users')
    .values({
      tenant_id: tenantId,
      account_id: account.id,
      role_id: role.id,
      email: account.email,
      display_name: account.display_name,
      last_login_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
};

export const createProject = async (
  trx: TenantTransaction,
  name: string,
  superAdmin: Seat,
): Promise<{ tenant: Tenant; userId: string }> => {
  const tenant = await trx
    .insertInto('tenants')
    .values({ slug: slugFor(name), name })
    .returningAll()
    .executeTakeFirstOrThrow();
  await applyTenantContext(trx, tenant.id);
  await addDefaultRoles(trx, tenant.id);
  await trx
    .insertInto('environments')
    .values(DEFAULT_ENVIRONMENTS.map((environment) => newEnvironment(tenant.id, environment)))
    .execute();
  return { tenant, userId: await addSeat(trx, tenant.id, superAdmin) };
};
