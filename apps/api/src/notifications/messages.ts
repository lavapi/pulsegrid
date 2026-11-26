import type { NotificationSwitches, Release } from '@pulsegrid/shared';
import type { GitPullRequest, PullRequestChecks } from '../pipelines/git/git-provider';

/** A message to one person, keyed by the event so it goes only once. */
export interface Notice {
  key: string;
  /** The switch a person turns this kind of message off with. */
  kind: keyof NotificationSwitches;
  githubLogin: string;
  text: string;
}

const RECENT_MS = 2 * 60 * 60_000;

/** Slack treats &, < and > as markup; anything shown from GitHub is escaped so it reads as written. */
const plain = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const link = (url: string, label: string): string => `<${url}|${label}>`;
const pullName = ({ repository, number, title }: GitPullRequest): string =>
  `*${plain(repository)}#${number}* “${plain(title)}”`;

export type PullRequestEvent = 'ready' | 'failed';

/** Ready once every check passed and GitHub would let it merge; failed once every check finished and one failed. */
export const pullRequestEvent = ({ outcome, mergeable }: PullRequestChecks): PullRequestEvent | null => {
  if (outcome === 'failed') return 'failed';
  return outcome === 'passed' && mergeable === 'clean' ? 'ready' : null;
};

export const pullRequestNotice = (
  pull: GitPullRequest,
  checks: PullRequestChecks,
  event: PullRequestEvent,
): Notice => ({
  key: `pr:${pull.repository}#${pull.number}:${pull.headSha}:${event}`,
  kind: event === 'ready' ? 'prReady' : 'prFailed',
  githubLogin: pull.author,
  text:
    event === 'ready'
      ? `✅ ${pullName(pull)}: all checks passed and it's ready to merge. ${link(pull.url, 'Open the pull request')}`
      : `❌ ${pullName(pull)}: ${plain(checks.failed.join(', '))} failed. ${link(pull.url, 'Open the pull request')}`,
});

const failedStage = ({ stages }: Release): string | null =>
  stages.find(({ status }) => status === 'failure')?.label ?? null;

/** When the release finished, so a deploy from days ago isn't announced when someone turns messages on. */
const finishedAt = ({ readyAt, run }: Release): string | null => readyAt ?? run?.finishedAt ?? null;

export const deployNotice = (release: Release, releasesUrl: string, now: number): Notice | null => {
  const { run, state } = release;
  const finished = finishedAt(release);
  if (!run?.actor || (state !== 'ready' && state !== 'failed') || !finished) return null;
  if (now - new Date(finished).getTime() > RECENT_MS) return null;
  const where = plain(release.environmentName ?? release.serviceName);
  const what = `*${plain(release.appName)}*`;
  const commit = `${run.commit}, “${plain(run.title)}”`;
  const links = `${link(releasesUrl, 'Open releases')} · ${link(run.url, 'View run')}`;
  const stage = failedStage(release);
  return {
    key: `deploy:${release.id}:${run.id}:${state}`,
    kind: state === 'ready' ? 'deployReady' : 'deployFailed',
    githubLogin: run.actor,
    text:
      state === 'ready'
        ? `🚀 ${what} is ready on *${where}* (${commit}). ${links}`
        : `💥 ${what} failed to deploy to *${where}*${stage ? ` at ${plain(stage)}` : ''} (${commit}). ${links}`,
  };
};
