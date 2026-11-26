import type { PipelineRun, Release } from '@pulsegrid/shared';
import { describe, expect, it, vi } from 'vitest';
import { deployNotice, pullRequestEvent, pullRequestNotice } from '../src/notifications/messages';
import { SlackClient, SlackError } from '../src/notifications/slack-client';
import type { GitPullRequest } from '../src/pipelines/git/git-provider';
import { checksOf } from '../src/pipelines/git/github/pull-request-checks';

const NOW = Date.parse('2026-11-26T12:00:00Z');

const passed = (name: string) => ({ name, status: 'completed', conclusion: 'success' });

const pull: GitPullRequest = {
  repository: 'acme-org/api',
  number: 42,
  title: 'Use <b> & friends',
  author: 'ada-dev',
  headSha: 'abc123',
  draft: false,
  url: 'https://github.com/acme-org/api/pull/42',
};

const run = (fields: Partial<PipelineRun> = {}): PipelineRun => ({
  id: '900',
  workflowId: '1',
  workflowName: 'Deploy',
  repository: 'acme-org/api',
  number: 7,
  title: 'Ship it',
  branch: 'main',
  commit: 'abc1234',
  event: 'push',
  actor: 'ada-dev',
  status: 'success',
  startedAt: '2026-11-26T11:30:00Z',
  finishedAt: '2026-11-26T11:40:00Z',
  durationSeconds: 600,
  url: 'https://github.com/run/900',
  ...fields,
});

const release = (fields: Partial<Release> = {}): Release => ({
  id: 'release-1',
  appId: 'app-1',
  appName: 'api',
  workflowId: '1',
  pipelineName: 'Deploy',
  serviceName: 'api-service',
  serviceDisplayName: null,
  servicePath: null,
  environmentName: 'staging',
  appDomains: [],
  run: run(),
  state: 'ready',
  stages: [],
  readyAt: '2026-11-26T11:45:00Z',
  matchedBy: null,
  issue: null,
  ...fields,
});

describe('pull request checks', () => {
  it('has nothing to report without checks', () => {
    expect(checksOf([], [], 'clean')).toEqual({ outcome: 'none', failed: [], mergeable: 'clean' });
  });

  it('waits while a check runs or a status is pending', () => {
    expect(checksOf([passed('lint'), { name: 'test', status: 'in_progress', conclusion: null }], [], 'clean').outcome).toBe('pending');
    expect(checksOf([passed('lint')], [{ context: 'ci', state: 'pending' }], 'clean').outcome).toBe('pending');
  });

  it('passes when every check passed, counting skipped and neutral', () => {
    const checks = checksOf(
      [passed('lint'), { name: 'docs', status: 'completed', conclusion: 'skipped' }, { name: 'x', status: 'completed', conclusion: 'neutral' }],
      [{ context: 'ci', state: 'success' }],
      'unstable',
    );
    expect(checks).toEqual({ outcome: 'passed', failed: [], mergeable: 'clean' });
  });

  it('names the failed checks and statuses', () => {
    const checks = checksOf(
      [passed('lint'), { name: 'test', status: 'completed', conclusion: 'failure' }, { name: 'e2e', status: 'completed', conclusion: 'timed_out' }],
      [{ context: 'legacy-ci', state: 'error' }],
      'blocked',
    );
    expect(checks).toEqual({ outcome: 'failed', failed: ['test', 'e2e', 'legacy-ci'], mergeable: 'blocked' });
  });

  it('maps what GitHub says about merging', () => {
    expect(checksOf([passed('a')], [], 'dirty').mergeable).toBe('conflicts');
    expect(checksOf([passed('a')], [], 'behind').mergeable).toBe('behind');
    expect(checksOf([passed('a')], [], null).mergeable).toBe('unknown');
  });
});

describe('pull request messages', () => {
  it('is ready only once checks passed and GitHub would merge it', () => {
    expect(pullRequestEvent({ outcome: 'passed', failed: [], mergeable: 'clean' })).toBe('ready');
    expect(pullRequestEvent({ outcome: 'passed', failed: [], mergeable: 'blocked' })).toBeNull();
    expect(pullRequestEvent({ outcome: 'passed', failed: [], mergeable: 'unknown' })).toBeNull();
    expect(pullRequestEvent({ outcome: 'pending', failed: ['x'], mergeable: 'clean' })).toBeNull();
    expect(pullRequestEvent({ outcome: 'failed', failed: ['x'], mergeable: 'conflicts' })).toBe('failed');
  });

  it('says it is ready to merge, escaping what GitHub shows', () => {
    expect(pullRequestNotice(pull, { outcome: 'passed', failed: [], mergeable: 'clean' }, 'ready')).toEqual({
      key: 'pr:acme-org/api#42:abc123:ready',
      kind: 'prReady',
      githubLogin: 'ada-dev',
      text: "✅ *acme-org/api#42* “Use &lt;b&gt; &amp; friends”: all checks passed and it's ready to merge. <https://github.com/acme-org/api/pull/42|Open the pull request>",
    });
  });

  it('names the checks that failed', () => {
    const notice = pullRequestNotice(pull, { outcome: 'failed', failed: ['test', 'e2e'], mergeable: 'clean' }, 'failed');
    expect(notice.kind).toBe('prFailed');
    expect(notice.key).toBe('pr:acme-org/api#42:abc123:failed');
    expect(notice.text).toContain(': test, e2e failed.');
  });
});

describe('deploy messages', () => {
  const RELEASES = 'https://dash.example.test/releases';

  it('says a deploy is ready to the person who started it', () => {
    expect(deployNotice(release(), RELEASES, NOW)).toEqual({
      key: 'deploy:release-1:900:ready',
      kind: 'deployReady',
      githubLogin: 'ada-dev',
      text: '🚀 *api* is ready on *staging* (abc1234, “Ship it”). <https://dash.example.test/releases|Open releases> · <https://github.com/run/900|View run>',
    });
  });

  it('names the stage a failed deploy stopped at', () => {
    const notice = deployNotice(
      release({ state: 'failed', readyAt: null, stages: [{ label: 'Rollout', status: 'failure', detail: null, durationSeconds: null }] }),
      RELEASES,
      NOW,
    );
    expect(notice?.kind).toBe('deployFailed');
    expect(notice?.text).toContain('💥 *api* failed to deploy to *staging* at Rollout');
  });

  it('skips deploys still going, without a person, or finished over two hours ago', () => {
    expect(deployNotice(release({ state: 'deploying' }), RELEASES, NOW)).toBeNull();
    expect(deployNotice(release({ run: run({ actor: '' }) }), RELEASES, NOW)).toBeNull();
    expect(deployNotice(release({ readyAt: '2026-11-26T09:59:00Z' }), RELEASES, NOW)).toBeNull();
  });
});

describe('Slack client', () => {
  const answer = (payload: object, status = 200) =>
    vi.fn(async () => new Response(JSON.stringify(payload), { status }));

  it('finds a person by email with a form-encoded call', async () => {
    const fetcher = answer({ ok: true, user: { id: 'U1', name: 'ada', profile: { display_name: 'Ada L' } } });
    const user = await new SlackClient('xoxb-token', fetcher).userByEmail('ada@example.test');
    expect(user).toEqual({ id: 'U1', name: 'Ada L' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://slack.com/api/users.lookupByEmail');
    expect(init.headers).toMatchObject({ authorization: 'Bearer xoxb-token', 'content-type': 'application/x-www-form-urlencoded' });
    expect(init.body).toBe('email=ada%40example.test');
  });

  it('returns no one when Slack has no such person', async () => {
    expect(await new SlackClient('t', answer({ ok: false, error: 'users_not_found' })).userByEmail('x@example.test')).toBeNull();
  });

  it('turns Slack error codes into readable messages, keeping the code', async () => {
    const error = await new SlackClient('t', answer({ ok: false, error: 'invalid_auth' })).workspace().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SlackError);
    expect(error).toMatchObject({ code: 'invalid_auth', message: expect.stringContaining('Bot User OAuth Token') });
    const unknown = await new SlackClient('t', answer({ ok: false, error: 'something_new' })).message('U1', 'hi').catch((caught: unknown) => caught);
    expect((unknown as Error).message).toBe("Slack couldn't do that right now. Try again in a minute.");
  });

  it('reads a rate limit and an unreachable Slack', async () => {
    const limited = await new SlackClient('t', answer({}, 429)).workspace().catch((caught: unknown) => caught);
    expect(limited).toMatchObject({ code: 'ratelimited' });
    const offline = await new SlackClient('t', vi.fn(async () => Promise.reject(new TypeError('fetch failed')))).workspace().catch((caught: unknown) => caught);
    expect(offline).toMatchObject({ code: 'unreachable' });
  });
});
