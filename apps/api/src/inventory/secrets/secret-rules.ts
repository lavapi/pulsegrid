import { DATA_PERMISSIONS, type SecretAccess, type UserPermission } from '@pulsegrid/shared';
import { environmentBlockedReason } from '../actions/action-rules';

const NEEDS_PERMISSION = `Ask your super admin for the ${DATA_PERMISSIONS['secret.read'].label} permission.`;
const MANAGED = 'AWS manages this secret, so it can only be changed by its owning service.';

interface SecretRuleInput {
  granted: ReadonlySet<UserPermission>;
  environmentName: string | null;
  managedBy: unknown;
}

const denied = (reason: string): SecretAccess => ({ canRead: false, canWrite: false, reason });

export const secretAccess = ({
  granted,
  environmentName,
  managedBy,
}: SecretRuleInput): SecretAccess => {
  const blocked = environmentBlockedReason(environmentName);
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
