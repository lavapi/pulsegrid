import type { RoleInput } from '@pulsegrid/shared';
import type { TenantTransaction } from '../database/tenant-context';

const DEVELOPER_PERMISSIONS: RoleInput['permissions'] = [
  'activity.view',
  'accounts.sync',
  'pipeline.run',
  'pipeline_apps.manage',
];

export const ADMIN_ROLE = 'Admin';

export const DEFAULT_ROLES: readonly RoleInput[] = [
  {
    name: ADMIN_ROLE,
    permissions: [
      ...DEVELOPER_PERMISSIONS,
      'costs.view',
      'team.view',
      'integrations.manage',
      'environments.manage',
    ],
  },
  { name: 'Developer', permissions: DEVELOPER_PERMISSIONS },
  { name: 'Viewer', permissions: [] },
];

export const addDefaultRoles = async (trx: TenantTransaction, tenantId: string): Promise<void> => {
  for (const { name, permissions } of DEFAULT_ROLES) {
    const { id } = await trx
      .insertInto('roles')
      .values({ tenant_id: tenantId, name })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (permissions.length > 0) {
      await trx
        .insertInto('role_permissions')
        .values(permissions.map((permission) => ({ tenant_id: tenantId, role_id: id, permission })))
        .execute();
    }
  }
};
