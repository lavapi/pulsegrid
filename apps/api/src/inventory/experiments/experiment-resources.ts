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
    .leftJoin('resource_display_names', (join) =>
      join
        .onRef('resource_display_names.cloud_account_id', '=', 'resources.cloud_account_id')
        .onRef('resource_display_names.native_id', '=', 'resources.native_id'),
    )
    .select(['resources.id', 'resources.name', 'resources.type', 'resource_display_names.display_name'])
    .where('resources.cloud_account_id', '=', accountId)
    .where('resources.native_id', 'in', [...new Set(nativeIds)])
    .orderBy('resources.name')
    .execute();
  return rows.map(({ id, name, type, display_name: displayName }) => ({
    id,
    name,
    displayName,
    type,
    path: `/infrastructure/${categoryOf(type)}/${id}`,
  }));
};
