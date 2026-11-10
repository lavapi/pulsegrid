import {
  isActivePipelineStatus,
  permissionFor,
  type PipelineActionAccess,
  type PipelineApp,
  gitProvider,
  type RepositoryChoice,
  type PipelineDeploymentTime,
  type PipelineDefinition,
  type PipelineHistory,
  type PipelineJob,
  type PipelineRun,
  type PipelineRunDetail,
  type PipelineRunOptions,
  type PipelineSummary,
  type ReleasePipelineChoice,
  type UserPermission,
} from '@pulsegrid/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/session/auth-context';
import { TenantDatabase } from '../database/tenant-database';
import { askFor } from '../inventory/environments/environment-permissions';
import { chunk } from '../common/chunk';
import { GitConnectionsService } from './git/git-connections.service';
import { type GitClient, GitProviderError, type GitWorkflow } from './git/git-provider';
import { PipelineCache } from './pipeline-cache';
import { averageDeployments, deploymentsOf } from './deployment-times';
import { toPipelineApp } from './pipeline-apps';
import {
  branchForEnvironment,
  environmentOfRun,
  type EnvironmentRef,
  type PipelineContext,
  pipelineEnvironments,
  type PipelineLink,
  protectionFor,
  type Protection,
  type ProtectionTarget,
  runsFor,
  sortPipelines,
  toPipelineSummary,
} from './pipeline-summaries';

const DEFINITION_TTL_SECONDS = 1800;
const REPOSITORY_INFO_TTL_SECONDS = 3600;
const BRANCHES_TTL_SECONDS = 60;
const REPOSITORIES_TTL_SECONDS = 300;
const WORKFLOWS_TTL_SECONDS = 300;
const ACTIVE_RUNS_TTL_SECONDS = 6;
const IDLE_RUNS_TTL_SECONDS = 45;
const ACTIVE_JOBS_TTL_SECONDS = 4;
const FINISHED_JOBS_TTL_SECONDS = 60;
const REPOSITORIES_AT_ONCE = 6;

const PREFERRED_BRANCHES = ['dev', 'develop', 'staging'];
const MAX_RUN_BRANCHES = 3;
const SHARED_SCOPE = 'none';
const NO_CONNECTION = "This app's Git connection is missing. Add it under Settings > Integrations.";
const EMPTY_DEFINITION: PipelineDefinition = {
  manual: false,
  inputs: [],
  environments: [],
  environmentRule: null,
  opaqueEnvironment: false,
};

export interface StartRunRequest {
  appId: string;
  workflowId: string;
  branch: string;
  inputs: Record<string, string>;
}

export interface RunActionRequest {
  appId: string;
  runId: string;
}

export const accessFor = (granted: ReadonlySet<UserPermission>, { production }: Protection): PipelineActionAccess => {
  const needed = permissionFor('pipeline.run', production);
  return granted.has(needed)
    ? { canAct: true, production, reason: null }
    : { canAct: false, production, reason: askFor(needed) };
};

const validateInputs = (
  definition: PipelineDefinition,
  values: Record<string, string>,
): string | null => {
  const known = new Set(definition.inputs.map(({ name }) => name));
  if (Object.keys(values).some((name) => !known.has(name))) {
    return "That form doesn't match this pipeline any more. Reload the page.";
  }
  for (const input of definition.inputs) {
    const value = values[input.name] ?? '';
    if (input.required && value === '') {
      return `Enter a value for ${input.name}.`;
    }
    if (input.type === 'choice' && value !== '' && !input.options.includes(value)) {
      return `Choose a valid option for ${input.name}.`;
    }
    if (input.type === 'boolean' && value !== '' && value !== 'true' && value !== 'false') {
      return `Choose true or false for ${input.name}.`;
    }
    if (input.type === 'number' && value !== '' && Number.isNaN(Number(value))) {
      return `Enter a number for ${input.name}.`;
    }
  }
  return null;
};

const definitionBranches = (
  defaultBranch: string,
  workflow: GitWorkflow,
  runs: readonly PipelineRun[],
): string[] => {
  const runBranches = runs
    .filter(({ workflowId }) => workflowId === workflow.id)
    .map(({ branch }) => branch);
  const recent = [...new Set(runBranches)].slice(0, MAX_RUN_BRANCHES);
  return [...new Set([defaultBranch, ...recent, ...PREFERRED_BRANCHES])];
};

const inScope = ({ environmentIds }: PipelineSummary, scope: string | undefined): boolean => {
  if (scope === undefined) {
    return true;
  }
  if (environmentIds.length === 0) {
    return true;
  }
  return scope !== SHARED_SCOPE && environmentIds.includes(scope);
};

interface GitScope {
  app: PipelineApp;
  connectionId: string;
  client: GitClient;
}

const keyFor = ({ connectionId }: GitScope, suffix: string): string =>
  `${connectionId}:${suffix}`;

const messageFor = (error: unknown): string =>
  error instanceof GitProviderError ? error.userMessage : "We couldn't read your Git provider just now.";

const issueCollector = (logger: Logger) => {
  const issues = new Set<string>();
  const note = (error: unknown): void => {
    logger.warn(`Git read failed: ${(error as Error).message}`);
    issues.add(messageFor(error));
  };
  return { note, issues };
};

@Injectable()
export class PipelinesService {
  private readonly logger = new Logger(PipelinesService.name);

  constructor(
    private readonly connections: GitConnectionsService,
    private readonly cache: PipelineCache,
    private readonly database: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  async isConnected(tenantId: string): Promise<boolean> {
    return (await this.connections.list(tenantId)).length > 0;
  }

  async forEnvironment(tenantId: string, environmentId: string): Promise<PipelineSummary[]> {
    const apps = await this.apps(tenantId);
    const { pipelines } = await this.forApps(tenantId, apps, environmentId);
    return pipelines.filter(({ environmentIds }) => environmentIds.includes(environmentId));
  }

  async forApps(
    tenantId: string,
    apps: readonly PipelineApp[],
    scope?: string,
  ): Promise<{ pipelines: PipelineSummary[]; issues: string[] }> {
    const { note, issues } = issueCollector(this.logger);
    const summaries = await this.appSummaries(tenantId, apps, note, scope);
    return {
      pipelines: sortPipelines(summaries.filter((item) => inScope(item, scope))),
      issues: [...issues],
    };
  }

  async deploymentTimes(tenantId: string, app: PipelineApp): Promise<PipelineDeploymentTime[]> {
    const { links, environments } = await this.linkData(tenantId, app);
    const git = await this.scopeFor(tenantId, app);
    if (!git) {
      return averageDeployments([], environments);
    }
    try {
      const workflows = await this.workflows(git);
      const repositoryRuns = await this.runs(git);
      const deployments = await Promise.all(
        workflows.map(async (workflow) => {
          const definition = await this.definition(git, workflow, repositoryRuns);
          const context = { appId: app.id, workflow, definition, links, environments };
          return pipelineEnvironments(context).length > 0
            ? deploymentsOf(context, await this.runs(git, workflow.id))
            : [];
        }),
      );
      return averageDeployments(deployments.flat(), environments);
    } catch (error) {
      this.logger.warn(`Git read failed: ${(error as Error).message}`);
      return averageDeployments([], environments);
    }
  }

  async pipelineChoices(tenantId: string): Promise<ReleasePipelineChoice[]> {
    const apps = await this.apps(tenantId);
    const { pipelines } = await this.forApps(tenantId, apps);
    return pipelines.map(({ appId, workflowId, name }) => ({
      appId,
      workflowId,
      label: `${apps.find(({ id }) => id === appId)?.name ?? ''}: ${name}`,
    }));
  }

  async latestRelease(
    tenantId: string,
    appId: string,
    workflowId: string,
    environmentName: string | null,
  ): Promise<{ name: string; run: PipelineRun | null; jobs: PipelineJob[] }> {
    const git = await this.requireScope(tenantId, appId);
    const workflow = await this.requireWorkflow(git, workflowId);
    return this.call(async () => {
      const allRuns = await this.runs(git, workflowId);
      const context = await this.contextFor(tenantId, git, workflow, allRuns);
      const environment = context.environments.find(({ name }) => name === environmentName);
      const run = runsFor(context, allRuns, environment)[0] ?? null;
      return { name: workflow.name, run, jobs: run ? await this.jobs(git, run) : [] };
    });
  }

  async repositoryChoices(tenantId: string): Promise<RepositoryChoice[]> {
    const connections = await this.connections.list(tenantId);
    const lists = await Promise.all(
      connections.map(async ({ id, name, organization }) => {
        const client = await this.connections.clientFor(tenantId, id);
        if (!client) {
          return [];
        }
        try {
          const repositories = await this.cache.remember(
            `${id}:repos:${organization}`,
            REPOSITORIES_TTL_SECONDS,
            () => client.listRepositories(organization),
          );
          return repositories.map(({ fullName }) => ({
            connectionId: id,
            connectionName: name,
            repository: fullName,
          }));
        } catch (error) {
          this.logger.warn(`Git read failed: ${(error as Error).message}`);
          return [];
        }
      }),
    );
    return lists.flat();
  }

  async history(
    auth: AuthContext,
    appId: string,
    workflowId: string,
    scope?: string,
  ): Promise<PipelineHistory> {
    const git = await this.requireScope(auth.tenantId, appId);
    const workflow = await this.requireWorkflow(git, workflowId);
    const allRuns = await this.call(() => this.runs(git, workflowId));
    const context = await this.contextFor(auth.tenantId, git, workflow, allRuns);
    const environment = context.environments.find(({ id }) => id === scope) ?? null;
    const routed = Boolean(context.definition?.environmentRule);
    const runs = routed ? runsFor(context, allRuns, environment) : allRuns;
    return {
      app: git.app,
      pipeline: toPipelineSummary(context, allRuns, environment),
      runs,
      options: await this.runOptions(auth, git, context, environment),
    };
  }

  async runDetail(auth: AuthContext, appId: string, runId: string): Promise<PipelineRunDetail> {
    const git = await this.requireScope(auth.tenantId, appId);
    const { repository } = git.app;
    return this.call(async () => {
      const run = await git.client.getRun(repository, runId);
      const jobs = await this.jobs(git, run);
      const context = await this.contextForRun(auth.tenantId, git, run);
      return {
        app: git.app,
        rerunsFailedJobs: await this.rerunsFailedJobs(auth.tenantId, git),
        run,
        jobs,
        access: this.accessOf(auth, context, { branch: run.branch }),
        environmentName: environmentOfRun(context, run),
      };
    });
  }

  async link(
    auth: AuthContext,
    appId: string,
    workflowId: string,
    environmentId: string | null,
    ipAddress: string | undefined,
  ): Promise<void> {
    const { app } = await this.requireScope(auth.tenantId, appId);
    await this.database.run(auth.tenantId, async (trx) => {
      const environment = environmentId
        ? await trx
            .selectFrom('environments')
            .select('name')
            .where('id', '=', environmentId)
            .executeTakeFirst()
        : null;
      if (environmentId && !environment) {
        throw new NotFoundException('That environment no longer exists.');
      }
      await trx
        .insertInto('pipeline_links')
        .values({
          tenant_id: auth.tenantId,
          app_id: app.id,
          workflow_id: workflowId,
          environment_id: environmentId,
        })
        .onConflict((conflict) =>
          conflict.columns(['app_id', 'workflow_id']).doUpdateSet({ environment_id: environmentId }),
        )
        .execute();
      await this.audit.record(trx, {
        tenantId: auth.tenantId,
        action: 'pipeline.environment_linked',
        actor: { userId: auth.userId, email: auth.email },
        target: { type: 'pipeline', id: `${app.repository}/${workflowId}` },
        ipAddress,
        metadata: { label: app.repository, environment: environment?.name ?? null },
      });
    });
  }

  async startRun(
    auth: AuthContext,
    request: StartRunRequest,
    ipAddress: string | undefined,
  ): Promise<void> {
    const { appId, workflowId, branch, inputs } = request;
    const git = await this.requireScope(auth.tenantId, appId);
    const { repository } = git.app;
    const workflow = await this.requireWorkflow(git, workflowId);
    const runs = await this.call(() => this.runs(git, workflowId));
    const context = await this.contextFor(auth.tenantId, git, workflow, runs);
    const target = { branch };
    await this.authorize(auth, context, target, 'run', ipAddress);

    const definition = context.definition ?? EMPTY_DEFINITION;
    if (!definition.manual) {
      throw new ConflictException("This pipeline can't be started manually.");
    }
    const branches = await this.call(() => this.branches(git));
    if (!branches.includes(branch)) {
      throw new BadRequestException('That branch no longer exists.');
    }
    const problem = validateInputs(definition, inputs);
    if (problem) {
      throw new BadRequestException(problem);
    }

    await this.call(() => git.client.startRun(repository, workflowId, branch, inputs));
    await this.finishAction(auth, git, context, target, 'pipeline.run_started', ipAddress, {
      branch,
      inputs: Object.keys(inputs),
    });
  }

  async rerun(
    auth: AuthContext,
    request: RunActionRequest & { failedOnly: boolean },
    ipAddress: string | undefined,
  ): Promise<void> {
    const { appId, runId, failedOnly } = request;
    const { git, context, target } = await this.actionContext(auth, appId, runId);
    await this.authorize(auth, context, target, 're-run', ipAddress);
    await this.call(() => git.client.rerun(git.app.repository, runId, failedOnly));
    await this.finishAction(auth, git, context, target, 'pipeline.rerun', ipAddress, {
      runId,
      failedOnly,
    });
    await this.cache.forget(keyFor(git, `jobs:${runId}`));
  }

  async cancel(
    auth: AuthContext,
    request: RunActionRequest,
    ipAddress: string | undefined,
  ): Promise<void> {
    const { appId, runId } = request;
    const { git, context, target } = await this.actionContext(auth, appId, runId);
    await this.authorize(auth, context, target, 'cancel', ipAddress);
    await this.call(() => git.client.cancel(git.app.repository, runId));
    await this.finishAction(auth, git, context, target, 'pipeline.cancelled', ipAddress, { runId });
    await this.cache.forget(keyFor(git, `jobs:${runId}`));
  }

  private jobs(git: GitScope, run: PipelineRun): Promise<PipelineJob[]> {
    const ttl = isActivePipelineStatus(run.status)
      ? ACTIVE_JOBS_TTL_SECONDS
      : FINISHED_JOBS_TTL_SECONDS;
    return this.cache.remember<PipelineJob[]>(keyFor(git, `jobs:${run.id}`), ttl, () =>
      git.client.listJobs(git.app.repository, run.id),
    );
  }

  private async rerunsFailedJobs(tenantId: string, { connectionId }: GitScope): Promise<boolean> {
    const connections = await this.connections.list(tenantId);
    const connection = connections.find(({ id }) => id === connectionId);
    return gitProvider(connection?.provider ?? '')?.rerunsFailedJobs ?? false;
  }

  private async apps(tenantId: string): Promise<PipelineApp[]> {
    const rows = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('pipeline_apps').selectAll().execute(),
    );
    return rows.map(toPipelineApp);
  }

  private async scopeFor(tenantId: string, app: PipelineApp): Promise<GitScope | null> {
    const connectionId = app.connectionId;
    const client = connectionId ? await this.connections.clientFor(tenantId, connectionId) : null;
    return connectionId && client ? { app, connectionId, client } : null;
  }

  private async requireScope(tenantId: string, appId: string): Promise<GitScope> {
    const row = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('pipeline_apps').selectAll().where('id', '=', appId).executeTakeFirst(),
    );
    if (!row) {
      throw new NotFoundException('That pipeline no longer exists.');
    }
    const git = await this.scopeFor(tenantId, toPipelineApp(row));
    if (!git) {
      throw new ConflictException(NO_CONNECTION);
    }
    return git;
  }

  private async actionContext(auth: AuthContext, appId: string, runId: string) {
    const git = await this.requireScope(auth.tenantId, appId);
    const run = await this.call(() => git.client.getRun(git.app.repository, runId));
    const context = await this.call(() => this.contextForRun(auth.tenantId, git, run));
    return { git, context, target: { branch: run.branch } };
  }

  private async contextForRun(
    tenantId: string,
    git: GitScope,
    run: PipelineRun,
  ): Promise<PipelineContext> {
    const workflows = await this.workflows(git);
    const workflow = workflows.find(({ id }) => id === run.workflowId) ?? {
      id: run.workflowId,
      repository: run.repository,
      name: run.workflowName,
      path: '',
      url: run.url,
    };
    const recentRuns = await this.runs(git, run.workflowId);
    return this.contextFor(tenantId, git, workflow, [run, ...recentRuns]);
  }

  private async authorize(
    auth: AuthContext,
    context: PipelineContext,
    target: ProtectionTarget,
    action: string,
    ipAddress: string | undefined,
  ): Promise<void> {
    const access = this.accessOf(auth, context, target);
    if (!access.canAct) {
      await this.record(auth, context, target, 'pipeline.action_denied', ipAddress, {
        action,
        reason: access.reason,
      });
      throw new ForbiddenException(access.reason ?? 'You do not have permission to do that.');
    }
  }

  private async finishAction(
    auth: AuthContext,
    git: GitScope,
    context: PipelineContext,
    target: ProtectionTarget,
    action: string,
    ipAddress: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.record(auth, context, target, action, ipAddress, metadata);
    await Promise.all([
      this.cache.forget(keyFor(git, `runs:${git.app.repository}:all`)),
      this.cache.forget(keyFor(git, `runs:${git.app.repository}:${context.workflow.id}`)),
    ]);
  }

  private record(
    auth: AuthContext,
    context: PipelineContext,
    target: ProtectionTarget,
    action: string,
    ipAddress: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const { repository, id, name } = context.workflow;
    const { production, label } = protectionFor(context, target);
    return this.database.run(auth.tenantId, (trx) =>
      this.audit.record(trx, {
        tenantId: auth.tenantId,
        action,
        actor: { userId: auth.userId, email: auth.email },
        target: { type: 'pipeline', id: `${repository}/${id}` },
        ipAddress,
        metadata: {
          label: `${repository}: ${name}`,
          environment: label === name ? null : label,
          production,
          ...metadata,
        },
      }),
    );
  }

  private accessOf(
    auth: AuthContext,
    context: PipelineContext,
    target: ProtectionTarget = {},
  ): PipelineActionAccess {
    return accessFor(auth.permissions, protectionFor(context, target));
  }

  private async runOptions(
    auth: AuthContext,
    git: GitScope,
    context: PipelineContext,
    environment: EnvironmentRef | null,
  ): Promise<PipelineRunOptions> {
    const [info, branches] = await Promise.all([
      this.call(() => this.repositoryInfo(git)),
      this.call(() => this.branches(git)),
    ]);
    const rule = context.definition?.environmentRule ?? null;
    const otherwiseBranch = rule
      ? (PREFERRED_BRANCHES.find((name) => name !== rule.branch && branches.includes(name)) ??
        branches.find((name) => name !== rule.branch))
      : undefined;
    const definition = context.definition ?? EMPTY_DEFINITION;
    const scopedBranch = environment && rule
      ? (branchForEnvironment(definition, environment) ?? otherwiseBranch)
      : undefined;
    return {
      definition,
      access: this.accessOf(auth, context, { environment }),
      branchAccess: rule
        ? {
            branch: rule.branch,
            matched: this.accessOf(auth, context, { branch: rule.branch }),
            otherwise: this.accessOf(auth, context, {
              branch: otherwiseBranch ?? `${rule.branch}-other`,
            }),
          }
        : null,
      defaultBranch: scopedBranch ?? info.defaultBranch,
      branches,
    };
  }

  private async contextFor(
    tenantId: string,
    git: GitScope,
    workflow: GitWorkflow,
    runs: readonly PipelineRun[],
  ): Promise<PipelineContext> {
    const [{ links, environments }, definition] = await Promise.all([
      this.linkData(tenantId, git.app),
      this.definition(git, workflow, runs),
    ]);
    return { appId: git.app.id, workflow, definition, links, environments };
  }

  private async definition(
    git: GitScope,
    workflow: GitWorkflow,
    runs: readonly PipelineRun[],
  ): Promise<PipelineDefinition | null> {
    try {
      const { defaultBranch } = await this.repositoryInfo(git);
      const candidates = definitionBranches(defaultBranch, workflow, runs);
      let first: PipelineDefinition | null = null;
      for (const ref of candidates) {
        const parsed = await this.cache.rememberStale<PipelineDefinition | null>(
          keyFor(git, `definition:${workflow.repository}:${workflow.path}:${ref}`),
          DEFINITION_TTL_SECONDS,
          () => git.client.readDefinition(workflow, ref),
        );
        if (parsed?.environmentRule) {
          return parsed;
        }
        first ??= parsed;
      }
      return first;
    } catch (error) {
      this.logger.warn(`Could not read a workflow: ${(error as Error).message}`);
      return null;
    }
  }

  private repositoryInfo(git: GitScope) {
    const { repository } = git.app;
    return this.cache.rememberStale(
      keyFor(git, `repository:${repository}`),
      REPOSITORY_INFO_TTL_SECONDS,
      () => git.client.getRepository(repository),
    );
  }

  private branches(git: GitScope): Promise<string[]> {
    const { repository } = git.app;
    return this.cache.remember(keyFor(git, `branches:${repository}`), BRANCHES_TTL_SECONDS, () =>
      git.client.listBranches(repository),
    );
  }

  private async requireWorkflow(git: GitScope, workflowId: string): Promise<GitWorkflow> {
    const workflows = await this.call(() => this.workflows(git));
    const workflow = workflows.find(({ id }) => id === workflowId);
    if (!workflow) {
      throw new NotFoundException('That pipeline no longer exists.');
    }
    return workflow;
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof GitProviderError) {
        throw new ServiceUnavailableException(error.userMessage);
      }
      throw error;
    }
  }

  private async appSummaries(
    tenantId: string,
    apps: readonly PipelineApp[],
    note: (error: unknown) => void,
    scope?: string,
  ): Promise<PipelineSummary[]> {
    const summaries: PipelineSummary[] = [];
    for (const batch of chunk(apps, REPOSITORIES_AT_ONCE)) {
      const results = await Promise.all(
        batch.map(async (app) => {
          const git = await this.scopeFor(tenantId, app);
          return git ? this.summariesOf(tenantId, git, note, scope) : [];
        }),
      );
      summaries.push(...results.flat());
    }
    return summaries;
  }

  private async summariesOf(
    tenantId: string,
    git: GitScope,
    note: (error: unknown) => void,
    scope?: string,
  ): Promise<PipelineSummary[]> {
    const { app } = git;
    const { links, environments } = await this.linkData(tenantId, app);
    const scopeEnvironment = environments.find(({ id }) => id === scope) ?? null;
    try {
      const workflows = await this.workflows(git);
      if (workflows.length === 0) {
        return [];
      }
      const runs = await this.runs(git);
      return await Promise.all(
        workflows.map(async (workflow) => {
          const definition = await this.definition(git, workflow, runs);
          const context = { appId: app.id, workflow, definition, links, environments };
          const workflowRuns = definition?.environmentRule
            ? await this.runs(git, workflow.id)
            : runs;
          return toPipelineSummary(context, workflowRuns, scopeEnvironment);
        }),
      );
    } catch (error) {
      note(error);
      return [];
    }
  }

  private workflows(git: GitScope): Promise<GitWorkflow[]> {
    const { repository } = git.app;
    return this.cache.rememberStale(keyFor(git, `workflows:${repository}`), WORKFLOWS_TTL_SECONDS, () =>
      git.client.listWorkflows(repository),
    );
  }

  private runs(git: GitScope, workflowId?: string): Promise<PipelineRun[]> {
    const { repository } = git.app;
    return this.cache.rememberStale<PipelineRun[]>(
      keyFor(git, `runs:${repository}:${workflowId ?? 'all'}`),
      (runs) =>
        runs.some(({ status }) => isActivePipelineStatus(status))
          ? ACTIVE_RUNS_TTL_SECONDS
          : IDLE_RUNS_TTL_SECONDS,
      () => git.client.listRuns(repository, workflowId),
    );
  }

  private linkData(
    tenantId: string,
    app: PipelineApp,
  ): Promise<{ links: PipelineLink[]; environments: EnvironmentRef[] }> {
    return this.database.run(tenantId, async (trx) => {
      const links = await trx
        .selectFrom('pipeline_links')
        .selectAll()
        .where('app_id', '=', app.id)
        .execute();
      const environments = await trx
        .selectFrom('environments')
        .select(['id', 'name', 'is_production as production'])
        .execute();
      return {
        environments,
        links: links.map((link) => ({
          repository: app.repository,
          workflowId: link.workflow_id,
          environmentId: link.environment_id,
        })),
      };
    });
  }
}
