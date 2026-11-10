import type { ExperimentAccess, UserPermission } from '@pulsegrid/shared';
import type { CloudAccountRow } from '../../database/schema';
import type { AccountEnvironment } from '../environments/account-environment';
import { environmentBlockedReason } from '../environments/environment-permissions';

export const RUN_PERMISSION = 'experiment.run';

export const NO_CREDENTIALS = 'This account has no access key. Add one under Integrations.';

export interface ExperimentAccount {
  account: CloudAccountRow;
  environment: AccountEnvironment | null;
}

export const experimentAccess = (
  { account, environment }: ExperimentAccount,
  granted: ReadonlySet<UserPermission>,
): ExperimentAccess => {
  const blockedReason =
    environmentBlockedReason(RUN_PERMISSION, environment, granted) ??
    (account.encrypted_credentials === null ? NO_CREDENTIALS : null);
  return { canRun: blockedReason === null, blockedReason };
};
