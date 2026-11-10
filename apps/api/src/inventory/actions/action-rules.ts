import type { CloudPermission, ResourceActionOption } from '@pulsegrid/shared';
import type { AccountEnvironment } from '../environments/account-environment';

const NEEDS_ENVIRONMENT = 'Assign this account to an environment first.';
const READ_ONLY = 'Production is read-only.';

export const environmentBlockedReason = (environment: AccountEnvironment | null): string | null => {
  if (!environment) {
    return NEEDS_ENVIRONMENT;
  }
  return environment.isProduction ? READ_ONLY : null;
};

export const actionOption = (
  permission: CloudPermission,
  environment: AccountEnvironment | null,
): ResourceActionOption => ({ permission, blockedReason: environmentBlockedReason(environment) });
