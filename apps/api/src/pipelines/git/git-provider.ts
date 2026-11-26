import type {
  GitAccessCheck,
  PipelineDefinition,
  PipelineJob,
  PipelineRun,
} from '@pulsegrid/shared';

export type GitCredentials = Record<string, string>;

export interface GitRepository {
  fullName: string;
}

export interface GitWorkflow {
  id: string;
  repository: string;
  name: string;
  path: string;
  url: string;
}

export interface GitRepositoryInfo {
  defaultBranch: string;
}

export class GitProviderError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
  }
}

export interface GitClient {
  checkAccess(organization: string): Promise<GitAccessCheck>;
  listRepositories(organization: string): Promise<GitRepository[]>;
  listWorkflows(repository: string): Promise<GitWorkflow[]>;
  listRuns(repository: string, workflowId?: string): Promise<PipelineRun[]>;
  getRun(repository: string, runId: string): Promise<PipelineRun>;
  listJobs(repository: string, runId: string): Promise<PipelineJob[]>;
  getRepository(repository: string): Promise<GitRepositoryInfo>;
  listBranches(repository: string): Promise<string[]>;
  readDefinition(workflow: GitWorkflow, ref: string): Promise<PipelineDefinition | null>;
  startRun(
    repository: string,
    workflowId: string,
    branch: string,
    inputs: Record<string, string>,
  ): Promise<void>;
  rerun(repository: string, runId: string, failedOnly: boolean): Promise<void>;
  cancel(repository: string, runId: string): Promise<void>;
}

export interface GitProvider {
  id: string;
  parseCredentials(input: unknown): GitCredentials | null;
  credentialHint(credentials: GitCredentials): string;
  connect(credentials: GitCredentials): GitClient;
}

export const GIT_PROVIDER_LIST = Symbol('GIT_PROVIDER_LIST');
