import type { ExperimentAccess, UserPermission } from '@pulsegrid/shared';
import { environmentBlockedReason } from '../environments/environment-permissions';
import type { ExperimentAccount } from './experiment-account';

export const RUN_PERMISSION = 'experiment.run';

export const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';

export const experimentAccess = (
  { account, environment }: ExperimentAccount,
  granted: ReadonlySet<UserPermission>,
): ExperimentAccess => {
  const blockedReason =
    environmentBlockedReason(RUN_PERMISSION, environment, granted) ??
    (account.encrypted_credentials === null ? NO_CREDENTIALS : null);
  return { canRun: blockedReason === null, blockedReason };
};
