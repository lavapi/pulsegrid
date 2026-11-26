import type { PullRequestChecks } from '../git-provider';

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface CommitStatus {
  context: string;
  state: string;
}

const PASSED = new Set(['success', 'neutral', 'skipped']);
const MERGEABLE: Record<string, PullRequestChecks['mergeable']> = {
  clean: 'clean',
  unstable: 'clean',
  has_hooks: 'clean',
  blocked: 'blocked',
  dirty: 'conflicts',
  behind: 'behind',
};

/**
 * The checks on a commit, from GitHub Actions-style check runs and older commit statuses: still running, all
 * passed, or some failed, naming them. A commit with no checks has nothing to report.
 */
export const checksOf = (
  runs: readonly CheckRun[],
  statuses: readonly CommitStatus[],
  mergeableState: string | null,
): PullRequestChecks => {
  const pending =
    runs.some(({ status }) => status !== 'completed') || statuses.some(({ state }) => state === 'pending');
  const failed = [
    ...runs.filter(({ status, conclusion }) => status === 'completed' && !PASSED.has(conclusion ?? '')).map(({ name }) => name),
    ...statuses.filter(({ state }) => state === 'failure' || state === 'error').map(({ context }) => context),
  ];
  const mergeable = MERGEABLE[mergeableState ?? ''] ?? 'unknown';
  if (runs.length + statuses.length === 0) {
    return { outcome: 'none', failed: [], mergeable };
  }
  if (pending) {
    return { outcome: 'pending', failed, mergeable };
  }
  return { outcome: failed.length > 0 ? 'failed' : 'passed', failed, mergeable };
};
