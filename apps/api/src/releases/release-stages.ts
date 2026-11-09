import type {
  PipelineJob,
  PipelineRun,
  PipelineStatus,
  ReleaseMatch,
  ReleaseStage,
  ReleaseStageStatus,
  ReleaseState,
} from '@pulsegrid/shared';
import { isActivePipelineStatus } from '@pulsegrid/shared';
import type { Deployment } from '../inventory/providers/provider';

const NO_ROLLOUT_AFTER_MS = 15 * 60 * 1000;
const COMMIT_TAG = /^[0-9a-f]{7,40}$/i;
const STEP_NOISE = /^(set up job|complete job|post )/i;
const DEFAULT_TARGET = 'Deploy';
const SKIPPED = 'Skipped';

type PipelineGroup = 'build' | 'test' | 'image' | 'deploy';

const GROUP_PATTERNS: readonly [PipelineGroup, RegExp][] = [
  ['test', /\b(tests?|lint|spec|specs|e2e|typecheck|check|checks)\b/],
  ['image', /\b(image|docker|ecr|push)\b/],
  ['deploy', /\b(deploy|deployment|rollout|ecs|release)\b/],
];
const GROUP_LABELS: Record<Exclude<PipelineGroup, 'deploy'>, string> = {
  build: 'Build',
  test: 'Test',
  image: 'Image',
};

interface PipelineItem {
  name: string;
  status: PipelineStatus;
  durationSeconds: number | null;
}

export interface ReleaseProgress {
  state: ReleaseState;
  stages: ReleaseStage[];
  readyAt: string | null;
  matchedBy: ReleaseMatch | null;
}

const toStageStatus = (status: PipelineStatus): ReleaseStageStatus => {
  const statuses: Record<PipelineStatus, ReleaseStageStatus> = {
    running: 'running',
    queued: 'waiting',
    unknown: 'waiting',
    success: 'success',
    skipped: 'waiting',
    failure: 'failure',
    cancelled: 'cancelled',
  };
  return statuses[status];
};

const groupOf = (name: string): PipelineGroup => {
  const words = name.toLowerCase().replace(/[_-]/g, ' ');
  return GROUP_PATTERNS.find(([, pattern]) => pattern.test(words))?.[0] ?? 'build';
};

const itemsOf = (jobs: readonly PipelineJob[]): PipelineItem[] => {
  const [only] = jobs;
  return jobs.length === 1 && only && only.steps.length > 0
    ? only.steps.filter(({ name }) => !STEP_NOISE.test(name))
    : [...jobs];
};

const combined = (items: readonly PipelineItem[]): ReleaseStageStatus => {
  const statuses = items.map(({ status }) => toStageStatus(status));
  const first = (['failure', 'cancelled', 'running'] as const).find((status) => statuses.includes(status));
  if (first) {
    return first;
  }
  const started = statuses.includes('success');
  if (statuses.includes('waiting')) {
    return started ? 'running' : 'waiting';
  }
  return 'success';
};

const totalSeconds = (items: readonly PipelineItem[]): number | null =>
  items.some(({ durationSeconds }) => durationSeconds !== null)
    ? items.reduce((total, { durationSeconds }) => total + (durationSeconds ?? 0), 0)
    : null;

const groupStage = (label: string, members: readonly PipelineItem[]): ReleaseStage => {
  const ran = members.filter(({ status }) => status !== 'skipped');
  return ran.length > 0
    ? { label, status: combined(ran), detail: null, durationSeconds: totalSeconds(ran) }
    : { label, status: 'waiting', detail: SKIPPED, durationSeconds: null };
};

const pipelineStages = (items: readonly PipelineItem[]): ReleaseStage[] => {
  const groups = (['build', 'test', 'image'] as const).map((group) => ({
    group,
    members: items.filter(({ name }) => groupOf(name) === group),
  }));
  const stages = groups
    .filter(({ members }) => members.length > 0)
    .map(({ group, members }) => groupStage(GROUP_LABELS[group], members));
  return stages.length > 0
    ? stages
    : [{ label: GROUP_LABELS.build, status: 'waiting', detail: null, durationSeconds: null }];
};

export const matchRollout = (run: PipelineRun, deployment: Deployment): ReleaseMatch | null => {
  const tags = deployment.images.map((image) => image.split(':').pop() ?? '');
  if (tags.some((tag) => tag.includes(run.commit))) {
    return 'commit';
  }
  if (tags.some((tag) => COMMIT_TAG.test(tag))) {
    return null;
  }
  const after =
    deployment.startedAt !== null &&
    run.startedAt !== null &&
    new Date(deployment.startedAt).getTime() >= new Date(run.startedAt).getTime();
  return after ? 'time' : null;
};

const rolloutDetail = ({ state, runningTasks, desiredTasks }: Deployment): string =>
  state === 'failed' ? 'Rollout failed' : `${runningTasks} of ${desiredTasks} tasks`;

const ROLLOUT_STATUSES: Record<Deployment['state'], ReleaseStageStatus> = {
  running: 'running',
  succeeded: 'success',
  failed: 'failure',
};

const ROLLOUT_STATES: Record<Deployment['state'], ReleaseState> = {
  running: 'deploying',
  succeeded: 'ready',
  failed: 'failed',
};

const isOverdue = ({ finishedAt }: PipelineRun, now: Date): boolean =>
  finishedAt !== null && now.getTime() - new Date(finishedAt).getTime() > NO_ROLLOUT_AFTER_MS;

const unfinishedState = (run: PipelineRun, now: Date): ReleaseState => {
  if (isActivePipelineStatus(run.status)) {
    return 'building';
  }
  if (run.status === 'failure') {
    return 'failed';
  }
  if (run.status === 'cancelled') {
    return 'cancelled';
  }
  return isOverdue(run, now) ? 'not_deployed' : 'deploying';
};

const stage = (
  label: string,
  status: ReleaseStageStatus,
  detail: string | null,
  durationSeconds: number | null = null,
): ReleaseStage => ({ label, status, detail, durationSeconds });

const unmatchedDeployStage = (label: string, state: ReleaseState, items: readonly PipelineItem[]) => {
  if (state === 'deploying') {
    return stage(label, 'running', 'Waiting for the rollout');
  }
  if (state === 'not_deployed') {
    return stage(label, 'waiting', 'No rollout seen');
  }
  return items.length > 0
    ? groupStage(label, items)
    : stage(label, 'waiting', null);
};

export const releaseProgress = (
  run: PipelineRun | null,
  jobs: readonly PipelineJob[],
  deployment: Deployment | null,
  now: Date,
): ReleaseProgress => {
  const label = deployment?.targetLabel ?? DEFAULT_TARGET;
  if (!run) {
    return {
      state: 'idle',
      stages: [...pipelineStages([]), stage(label, 'waiting', null), stage('Ready', 'waiting', null)],
      readyAt: null,
      matchedBy: null,
    };
  }
  const items = itemsOf(jobs);
  const earlier = pipelineStages(items);
  const finished = run.status === 'success';
  const matchedBy = finished && deployment ? matchRollout(run, deployment) : null;

  if (deployment && matchedBy) {
    const state = ROLLOUT_STATES[deployment.state];
    const ready = state === 'ready';
    return {
      state,
      stages: [
        ...earlier,
        stage(label, ROLLOUT_STATUSES[deployment.state], rolloutDetail(deployment)),
        stage('Ready', ready ? 'success' : 'waiting', null),
      ],
      readyAt: ready ? deployment.finishedAt : null,
      matchedBy,
    };
  }

  const state = unfinishedState(run, now);
  const deploySteps = items.filter(({ name }) => groupOf(name) === 'deploy');
  return {
    state,
    stages: [
      ...earlier,
      unmatchedDeployStage(label, state, deploySteps),
      stage('Ready', 'waiting', null),
    ],
    readyAt: null,
    matchedBy: null,
  };
};
