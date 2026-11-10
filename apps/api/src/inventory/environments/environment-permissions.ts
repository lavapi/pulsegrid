import {
  permissionFor,
  permissionLabel,
  productionPermission,
  type StagingPermission,
  type UserPermission,
} from '@pulsegrid/shared';
import type { AccountEnvironment } from './account-environment';

const NEEDS_ENVIRONMENT = 'Assign this account to an environment first.';

export const askFor = (permission: UserPermission): string =>
  `Ask your super admin for the ${permissionLabel(permission)} permission.`;

/** Why the person can't do this in the environment, or null when their role allows it. */
export const environmentBlockedReason = (
  permission: StagingPermission,
  environment: AccountEnvironment | null,
  granted: ReadonlySet<UserPermission>,
): string | null => {
  if (!environment) {
    return NEEDS_ENVIRONMENT;
  }
  const needed = permissionFor(permission, environment.isProduction);
  return granted.has(needed) ? null : askFor(needed);
};

export const holdsInAnyEnvironment = (permission: StagingPermission, granted: ReadonlySet<UserPermission>): boolean =>
  granted.has(permission) || granted.has(productionPermission(permission));
