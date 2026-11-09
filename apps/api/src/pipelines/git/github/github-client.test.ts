import { describe, expect, it, vi } from 'vitest';
import { GitProviderError } from '../git-provider';
import { GitHubClient, statusFrom, toPipelineRun } from './github-client';

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), init);

const run = {
  id: 12,
  workflow_id: 34,
  name: 'Deploy',
  display_title: 'Fix login',
  run_number: 7,
  head_branch: 'main',
  head_sha: 'abcdef1234567',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/o/r/actions/runs/12',
  run_started_at: '2026-11-04T10:00:00Z',
  updated_at: '2026-11-04T10:02:30Z',
  actor: { login: 'someone' },
  triggering_actor: { login: 'person' },
};

describe('statusFrom', () => {
  it.each([
    ['in_progress', null, 'running'],
    ['queued', null, 'queued'],
    ['waiting', null, 'queued'],
    ['completed', 'success', 'success'],
    ['completed', 'failure', 'failure'],
    ['completed', 'timed_out', 'failure'],
    ['completed', 'cancelled', 'cancelled'],
    ['completed', 'skipped', 'skipped'],
    ['completed', 'something-new', 'unknown'],
    [null, null, 'unknown'],
  ])('reads %s and %s as %s', (status, conclusion, expected) => {
    expect(statusFrom(status, conclusion)).toBe(expected);
  });
});

describe('toPipelineRun', () => {
  it('normalizes a finished run and prefers the triggering person', () => {
    expect(toPipelineRun('o/r', run)).toMatchObject({
      id: '12',
      workflowId: '34',
      commit: 'abcdef1',
      actor: 'person',
      status: 'success',
      durationSeconds: 150,
    });
  });

  it('has no end time while running', () => {
    expect(toPipelineRun('o/r', { ...run, status: 'in_progress', conclusion: null })).toMatchObject({
      status: 'running',
      finishedAt: null,
      durationSeconds: null,
    });
  });
});

describe('GitHubClient', () => {
  it('sends the token, skips archived repositories and follows pages', async () => {
    const full = Array.from({ length: 100 }, (_, index) => ({
      full_name: `o/r${index}`,
      archived: index === 0,
    }));
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json(full))
      .mockResolvedValueOnce(json([{ full_name: 'o/last', archived: false }]));

    const repositories = await new GitHubClient('secret', fetcher).listRepositories('o');

    expect(repositories).toHaveLength(100);
    expect(repositories.at(-1)?.fullName).toBe('o/last');
    expect(fetcher.mock.calls[0]?.[1].headers.authorization).toBe('Bearer secret');
  });

  it('only lists active workflows', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        workflows: [
          { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', html_url: 'u' },
          { id: 2, name: 'Old', path: 'old.yml', state: 'disabled_manually', html_url: 'u' },
        ],
      }),
    );
    const workflows = await new GitHubClient('t', fetcher).listWorkflows('o/r');
    expect(workflows.map(({ name }) => name)).toEqual(['CI']);
  });

  it('reads jobs and step durations', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      json({
        jobs: [
          {
            id: 1,
            name: 'build',
            status: 'in_progress',
            conclusion: null,
            started_at: '2026-11-04T10:00:00Z',
            completed_at: null,
            html_url: 'u',
            steps: [
              {
                number: 1,
                name: 'Checkout',
                status: 'completed',
                conclusion: 'success',
                started_at: '2026-11-04T10:00:00Z',
                completed_at: '2026-11-04T10:00:05Z',
              },
            ],
          },
        ],
      }),
    );
    const [job] = await new GitHubClient('t', fetcher).listJobs('o/r', '1');
    expect(job).toMatchObject({ status: 'running', durationSeconds: null });
    expect(job?.steps[0]).toMatchObject({ status: 'success', durationSeconds: 5 });
  });

  it.each([
    [401, {}, 'GitHub rejected the token. Replace it under Settings > Integrations.'],
    [403, { 'x-ratelimit-remaining': '0' }, 'GitHub rate limit reached. Pipelines will refresh shortly.'],
    [429, {}, 'GitHub rate limit reached. Pipelines will refresh shortly.'],
    [403, {}, "The GitHub token can't read this. Check its permissions."],
    [404, {}, "The GitHub token can't read this. Check its permissions."],
    [500, {}, "We couldn't reach GitHub. Please try again."],
  ])('turns %s into a friendly error', async (status, headers, message) => {
    const fetcher = vi.fn().mockResolvedValue(json({ message: 'raw' }, { status, headers }));
    await expect(new GitHubClient('t', fetcher).getRun('o/r', '1')).rejects.toMatchObject({
      userMessage: message,
    });
  });

  it('handles network failure', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('socket'));
    await expect(new GitHubClient('t', fetcher).getRun('o/r', '1')).rejects.toBeInstanceOf(
      GitProviderError,
    );
  });

  it('starts a run on a branch with inputs', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await new GitHubClient('t', fetcher).startRun('o/r', '5', 'main', { tag: 'v1' });
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/repos/o/r/actions/workflows/5/dispatches');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ ref: 'main', inputs: { tag: 'v1' } });
  });

  it.each([
    [true, 'rerun-failed-jobs'],
    [false, 'rerun'],
  ])('re-runs with failedOnly %s', async (failedOnly, action) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    await new GitHubClient('t', fetcher).rerun('o/r', '9', failedOnly);
    expect(fetcher.mock.calls[0]?.[0]).toMatch(new RegExp(`/runs/9/${action}$`));
  });

  it('explains when the token is read-only', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ message: 'raw' }, { status: 403 }));
    await expect(new GitHubClient('t', fetcher).cancel('o/r', '1')).rejects.toMatchObject({
      userMessage: "The GitHub token can't run pipelines. It needs Actions read and write access.",
    });
  });

  it('explains when a run can no longer be changed', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ message: 'raw' }, { status: 409 }));
    await expect(new GitHubClient('t', fetcher).cancel('o/r', '1')).rejects.toMatchObject({
      userMessage: "GitHub won't allow that for this run. It may have finished or be too old to re-run.",
    });
  });

  it('returns nothing for a missing file', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({}, { status: 404 }));
    expect(await new GitHubClient('t', fetcher).readFile('o/r', 'a/b.yml', 'dev')).toBeNull();
  });
});
