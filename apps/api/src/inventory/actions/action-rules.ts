import type { CloudPermission, ResourceActionOption, UserPermission } from '@pulsegrid/shared';
import type { AccountEnvironment } from '../environments/account-environment';
import { environmentBlockedReason } from '../environments/environment-permissions';

export const actionOption = (
  permission: CloudPermission,
  environment: AccountEnvironment | null,
  granted: ReadonlySet<UserPermission>,
): ResourceActionOption => ({ permission, blockedReason: environmentBlockedReason(permission, environment, granted) });
