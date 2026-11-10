import type { SecretAccess, UserPermission } from '@pulsegrid/shared';
import type { AccountEnvironment } from '../environments/account-environment';
import { environmentBlockedReason } from '../environments/environment-permissions';

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
  const readBlocked = environmentBlockedReason('secret.read', environment, granted);
  const canChange = environmentBlockedReason('secret.write', environment, granted) === null;
  if (readBlocked && !canChange) {
    return denied(readBlocked);
  }
  const managed = Boolean(managedBy);
  return { canRead: true, canWrite: canChange && !managed, reason: managed ? MANAGED : null };
};
