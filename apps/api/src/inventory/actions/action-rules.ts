import type { CloudPermission, ResourceActionOption } from '@pulsegrid/shared';
import { isKnownNonProductionName } from '../environments/environment-detection';

const NEEDS_ENVIRONMENT = 'Assign this account to an environment first.';
const READ_ONLY = 'Production is read-only.';

export const environmentBlockedReason = (environmentName: string | null): string | null => {
  if (environmentName === null) {
    return NEEDS_ENVIRONMENT;
  }
  return isKnownNonProductionName(environmentName) ? null : READ_ONLY;
};

export const actionOption = (
  permission: CloudPermission,
  environmentName: string | null,
): ResourceActionOption => ({ permission, blockedReason: environmentBlockedReason(environmentName) });
