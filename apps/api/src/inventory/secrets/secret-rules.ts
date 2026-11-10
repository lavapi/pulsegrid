import { DATA_PERMISSIONS, type SecretAccess, type UserPermission } from '@pulsegrid/shared';
import { environmentBlockedReason } from '../actions/action-rules';
import type { AccountEnvironment } from '../environments/account-environment';

const NEEDS_PERMISSION = `Ask your super admin for the ${DATA_PERMISSIONS['secret.read'].label} permission.`;
const MANAGED = 'AWS manages this secret, so it can only be changed by its owning service.';

interface SecretRuleInput {
  granted: ReadonlySet<UserPermission>;
  environment: AccountEnvironment | null;
  managedBy: unknown;
}

const denied = (reason: string): SecretAccess => ({ canRead: false, canWrite: false, reason });

export const secretAccess = ({
  granted,
  environment,
  managedBy,
}: SecretRuleInput): SecretAccess => {
  const blocked = environmentBlockedReason(environment);
  if (blocked) {
    return denied(blocked);
  }
  const canChange = granted.has('secret.write');
  if (!canChange && !granted.has('secret.read')) {
    return denied(NEEDS_PERMISSION);
  }
  const managed = Boolean(managedBy);
  return { canRead: true, canWrite: canChange && !managed, reason: managed ? MANAGED : null };
};
