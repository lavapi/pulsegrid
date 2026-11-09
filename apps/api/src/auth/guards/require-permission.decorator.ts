import type { UserPermission } from '@pulsegrid/shared';
import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS = 'requiredPermissions';

export const RequirePermission = (...anyOf: [UserPermission, ...UserPermission[]]) =>
  SetMetadata(REQUIRED_PERMISSIONS, anyOf);
