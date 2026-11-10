import type { ExperimentAccess, UserPermission } from '@pulsegrid/shared';
import type { CloudAccountRow } from '../../database/schema';
import { environmentBlockedReason } from '../actions/action-rules';
import type { AccountEnvironment } from '../environments/account-environment';

export const RUN_PERMISSION = 'experiment.run';

const NEEDS_PERMISSION = 'Ask your super admin for the Run staging fault experiments permission.';
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
    environmentBlockedReason(environment) ??
    (account.encrypted_credentials === null ? NO_CREDENTIALS : null) ??
    (granted.has(RUN_PERMISSION) ? null : NEEDS_PERMISSION);
  return { canRun: blockedReason === null, blockedReason };
};
