import { productionPermission, type StagingPermission, type UserPermission } from '@pulsegrid/shared';
import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS = 'requiredPermissions';

export const RequirePermission = (...anyOf: [UserPermission, ...UserPermission[]]) =>
  SetMetadata(REQUIRED_PERMISSIONS, anyOf);

/** Lets in people who hold the permission for staging or for production; the service checks which applies. */
export const RequireEnvironmentPermission = (permission: StagingPermission) =>
  RequirePermission(permission, productionPermission(permission));
