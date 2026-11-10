import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import type { TenantTransaction } from '../../database/tenant-context';
import { type AccountEnvironment, toAccountEnvironment } from './account-environment';

const ENVIRONMENT_MISSING = 'That environment no longer exists.';
const LEAVES_PRODUCTION = 'Only the super admin can move an account out of production.';

export const findEnvironment = async (
  trx: TenantTransaction,
  id: string | null,
): Promise<AccountEnvironment | null> => {
  if (id === null) {
    return null;
  }
  const row = await trx
    .selectFrom('environments')
    .select(['name', 'is_production'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) {
    throw new NotFoundException(ENVIRONMENT_MISSING);
  }
  return toAccountEnvironment(row.name, row.is_production);
};

export const checkAccountMove = async (
  trx: TenantTransaction,
  auth: AuthContext,
  fromId: string | null,
  toId: string | null,
): Promise<AccountEnvironment | null> => {
  const target = await findEnvironment(trx, toId);
  if (auth.isOwner || fromId === null || fromId === toId) {
    return target;
  }
  const current = await trx
    .selectFrom('environments')
    .select('is_production')
    .where('id', '=', fromId)
    .executeTakeFirst();
  if (current?.is_production && !target?.isProduction) {
    throw new ForbiddenException(LEAVES_PRODUCTION);
  }
  return target;
};
