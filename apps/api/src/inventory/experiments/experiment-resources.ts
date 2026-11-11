import { categoryOf, type ExperimentResource } from '@pulsegrid/shared';
import type { TenantTransaction } from '../../database/tenant-context';

/** The resources PulseGrid knows among those a test picked, linked to their pages. */
export const knownResources = async (
  trx: TenantTransaction,
  accountId: string,
  nativeIds: readonly string[],
): Promise<ExperimentResource[]> => {
  if (nativeIds.length === 0) {
    return [];
  }
  const rows = await trx
    .selectFrom('resources')
    .select(['id', 'name', 'type'])
    .where('cloud_account_id', '=', accountId)
    .where('native_id', 'in', [...new Set(nativeIds)])
    .orderBy('name')
    .execute();
  return rows.map(({ id, name, type }) => ({ id, name, type, path: `/infrastructure/${categoryOf(type)}/${id}` }));
};
