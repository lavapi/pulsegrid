import type {
  GitAccessCheck,
  PipelineDefinition,
  PipelineJob,
  PipelineRun,
  PipelineStatus,
  PipelineStep,
} from '@pulsegrid/shared';
import {
  GitProviderError,
  type GitClient,
  type GitRepository,
  type GitRepositoryInfo,
  type GitWorkflow,
} from '../git-provider';
import { parseWorkflowDefinition } from './workflow-definition';

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const PAGE_SIZE = 100;
const MAX_REPOSITORY_PAGES = 5;
const RUNS_PER_REQUEST = 50;
const WORKFLOW_FOLDER = '.github/workflows/';

interface GitHubAccessRepository {
  permissions?: { push?: boolean };
}

interface GitHubRun {
  id: number;
  workflow_id: number;
  name: string | null;
  display_title: string;
  run_number: number;
  head_branch: string | null;
  head_sha: string;
  event: string;
  status: string | null;
  conclusion: string | null;
  html_url: string;
  run_started_at: string | null;
  updated_at: string;
  actor: { login: string } | null;
  triggering_actor?: { login: string } | null;
}

interface GitHubStep {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface GitHubJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  html_url: string;
  steps?: GitHubStep[];
}

const ACTIVE_STATES = new Set(['in_progress']);
const QUEUED_STATES = new Set(['queued', 'waiting', 'requested', 'pending']);
const CONCLUSIONS: Record<string, PipelineStatus> = {
  success: 'success',
  failure: 'failure',
  timed_out: 'failure',
  startup_failure: 'failure',
  action_required: 'failure',
  cancelled: 'cancelled',
  skipped: 'skipped',
  neutral: 'skipped',
  stale: 'skipped',
};

export const statusFrom = (
  status: string | null | undefined,
  conclusion: string | null | undefined,
): PipelineStatus => {
  if (status && ACTIVE_STATES.has(status)) {
    return 'running';
  }
  if (status && QUEUED_STATES.has(status)) {
    return 'queued';
  }
  return (conclusion && CONCLUSIONS[conclusion]) || 'unknown';
};

const secondsBetween = (start: string | null, end: string | null): number | null =>
  start && end
    ? Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000))
    : null;

export const toPipelineRun = (repository: string, run: GitHubRun): PipelineRun => {
  const status = statusFrom(run.status, run.conclusion);
  const finished = status !== 'running' && status !== 'queued';
  const finishedAt = finished ? run.updated_at : null;
  return {
    id: String(run.id),
    workflowId: String(run.workflow_id),
    workflowName: run.name ?? run.display_title,
    repository,
    number: run.run_number,
    title: run.display_title,
    branch: run.head_branch ?? '',
    commit: run.head_sha.slice(0, 7),
    event: run.event,
    actor: run.triggering_actor?.login ?? run.actor?.login ?? null,
    status,
    startedAt: run.run_started_at,
    finishedAt,
    durationSeconds: secondsBetween(run.run_started_at, finishedAt),
    url: run.html_url,
  };
};

const toStep = (step: GitHubStep): PipelineStep => ({
  number: step.number,
  name: step.name,
  status: statusFrom(step.status, step.conclusion),
  durationSeconds: secondsBetween(step.started_at, step.completed_at),
});

const toJob = (job: GitHubJob): PipelineJob => ({
  id: String(job.id),
  name: job.name,
  status: statusFrom(job.status, job.conclusion),
  durationSeconds: secondsBetween(job.started_at, job.completed_at),
  url: job.html_url,
  steps: (job.steps ?? []).map(toStep),
});

const WRITE_DENIED =
  "The GitHub token can't run pipelines. It needs Actions read and write access.";
const RUN_NOT_ALLOWED =
  "GitHub won't allow that for this run. It may have finished or be too old to re-run.";

const writeErrorFor = (status: number, rateLimited: boolean): GitProviderError => {
  if (status === 403 && !rateLimited) {
    return new GitProviderError(WRITE_DENIED);
  }
  if (status === 409 || status === 422) {
    return new GitProviderError(RUN_NOT_ALLOWED);
  }
  return errorFor(status, rateLimited);
};

const errorFor = (status: number, rateLimited: boolean): GitProviderError => {
  if (status === 401) {
    return new GitProviderError('GitHub rejected the token. Replace it under Settings > Integrations.');
  }
  if (rateLimited || status === 429) {
    return new GitProviderError('GitHub rate limit reached. Pipelines will refresh shortly.');
  }
  if (status === 403 || status === 404) {
    return new GitProviderError("The GitHub token can't read this. Check its permissions.");
  }
  return new GitProviderError("We couldn't reach GitHub. Please try again.");
};

export class GitHubClient implements GitClient {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async checkAccess(organization: string): Promise<GitAccessCheck> {
    const [{ login }, repositories] = await Promise.all([
      this.get<{ login: string }>('/user').catch(() => ({ login: null })),
      this.get<GitHubAccessRepository[]>(
        `/orgs/${encodeURIComponent(organization)}/repos?per_page=${PAGE_SIZE}`,
      ),
    ]);
    if (repositories.length === 0) {
      throw new GitProviderError(`This token can't see any repositories in ${organization}.`);
    }
    return {
      account: login,
      repositories: repositories.length,
      canRun: repositories.some(({ permissions }) => permissions?.push) ? true : null,
    };
  }

  async listRepositories(organization: string): Promise<GitRepository[]> {
    const repositories: GitRepository[] = [];
    for (let page = 1; page <= MAX_REPOSITORY_PAGES; page += 1) {
      const batch = await this.get<{ full_name: string; archived: boolean }[]>(
        `/orgs/${encodeURIComponent(organization)}/repos?per_page=${PAGE_SIZE}&sort=pushed&page=${page}`,
      );
      repositories.push(
        ...batch.filter(({ archived }) => !archived).map(({ full_name: fullName }) => ({ fullName })),
      );
      if (batch.length < PAGE_SIZE) {
        break;
      }
    }
    return repositories;
  }

  async listWorkflows(repository: string): Promise<GitWorkflow[]> {
    const { workflows } = await this.get<{
      workflows: { id: number; name: string; path: string; state: string; html_url: string }[];
    }>(`/repos/${repository}/actions/workflows?per_page=${PAGE_SIZE}`);
    return workflows
      .filter(({ state }) => state === 'active')
      .map(({ id, name, path, html_url: url }) => ({
        id: String(id),
        repository,
        name,
        path,
        url,
      }));
  }

  async listRuns(repository: string, workflowId?: string): Promise<PipelineRun[]> {
    const scope = workflowId ? `/workflows/${encodeURIComponent(workflowId)}` : '';
    const { workflow_runs: runs } = await this.get<{ workflow_runs: GitHubRun[] }>(
      `/repos/${repository}/actions${scope}/runs?per_page=${RUNS_PER_REQUEST}`,
    );
    return runs.map((run) => toPipelineRun(repository, run));
  }

  async getRun(repository: string, runId: string): Promise<PipelineRun> {
    const run = await this.get<GitHubRun>(
      `/repos/${repository}/actions/runs/${encodeURIComponent(runId)}`,
    );
    return toPipelineRun(repository, run);
  }

  async listJobs(repository: string, runId: string): Promise<PipelineJob[]> {
    const { jobs } = await this.get<{ jobs: GitHubJob[] }>(
      `/repos/${repository}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=${PAGE_SIZE}`,
    );
    return jobs.map(toJob);
  }

  async getRepository(repository: string): Promise<GitRepositoryInfo> {
    const { default_branch: defaultBranch } = await this.get<{ default_branch: string }>(
      `/repos/${repository}`,
    );
    return { defaultBranch };
  }

  async listBranches(repository: string): Promise<string[]> {
    const branches = await this.get<{ name: string }[]>(
      `/repos/${repository}/branches?per_page=${PAGE_SIZE}`,
    );
    return branches.map(({ name }) => name);
  }

  async readDefinition(workflow: GitWorkflow, ref: string): Promise<PipelineDefinition | null> {
    if (!workflow.path.startsWith(WORKFLOW_FOLDER)) {
      return null;
    }
    const content = await this.readFile(workflow.repository, workflow.path, ref);
    return content === null ? null : parseWorkflowDefinition(content);
  }

  async readFile(repository: string, path: string, ref: string): Promise<string | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const response = await this.request(
      `/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
      { headers: { accept: 'application/vnd.github.raw+json' } },
    );
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw errorFor(response.status, response.headers.get('x-ratelimit-remaining') === '0');
    }
    return response.text();
  }

  startRun(
    repository: string,
    workflowId: string,
    branch: string,
    inputs: Record<string, string>,
  ): Promise<void> {
    return this.post(
      `/repos/${repository}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`,
      { ref: branch, inputs },
    );
  }

  rerun(repository: string, runId: string, failedOnly: boolean): Promise<void> {
    const action = failedOnly ? 'rerun-failed-jobs' : 'rerun';
    return this.post(`/repos/${repository}/actions/runs/${encodeURIComponent(runId)}/${action}`, {});
  }

  cancel(repository: string, runId: string): Promise<void> {
    return this.post(`/repos/${repository}/actions/runs/${encodeURIComponent(runId)}/cancel`, {});
  }

  private async post(path: string, body: unknown): Promise<void> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw writeErrorFor(response.status, response.headers.get('x-ratelimit-remaining') === '0');
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.fetcher(`${API_ROOT}${path}`, {
        ...init,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.token}`,
          'x-github-api-version': API_VERSION,
          ...init.headers,
        },
      });
    } catch {
      throw new GitProviderError("We couldn't reach GitHub. Please try again.");
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(path);
    if (!response.ok) {
      throw errorFor(response.status, response.headers.get('x-ratelimit-remaining') === '0');
    }
    return (await response.json()) as T;
  }
}
