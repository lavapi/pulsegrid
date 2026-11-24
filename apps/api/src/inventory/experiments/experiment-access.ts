import type { ExperimentAccess, UserPermission } from '@pulsegrid/shared';
import { environmentBlockedReason } from '../environments/environment-permissions';
import type { ExperimentAccount } from './experiment-account';
import { NOT_CONNECTED } from '../connection/account-credentials';

export const RUN_PERMISSION = 'experiment.run';


export const experimentAccess = (
  { account, environment }: ExperimentAccount,
  granted: ReadonlySet<UserPermission>,
): ExperimentAccess => {
  const blockedReason =
    environmentBlockedReason(RUN_PERMISSION, environment, granted) ??
    (account.encrypted_credentials === null ? NOT_CONNECTED : null);
  return { canRun: blockedReason === null, blockedReason };
};
