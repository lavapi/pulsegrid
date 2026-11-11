import type { CloudAccountRow } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { type AccountEnvironment, toAccountEnvironment } from '../environments/account-environment';

export interface ExperimentAccount {
  account: CloudAccountRow;
  environment: AccountEnvironment | null;
}

export const findExperimentAccount = async (
  trx: TenantTransaction,
  accountId: string,
): Promise<ExperimentAccount | null> => {
  const row = await trx
    .selectFrom('cloud_accounts')
    .leftJoin('environments', 'environments.id', 'cloud_accounts.environment_id')
    .selectAll('cloud_accounts')
    .select(['environments.name as environment_name', 'environments.is_production'])
    .where('cloud_accounts.id', '=', accountId)
    .executeTakeFirst();
  if (!row) {
    return null;
  }
  const { environment_name: name, is_production: isProduction, ...account } = row;
  return { account, environment: toAccountEnvironment(name, isProduction) };
};
