import type { DeploymentStageId, PipelineJob, PipelineRun, TrafficDeploymentStatus } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import type { Deployment } from '../inventory/providers/provider';
import { matchRollout, releaseProgress } from './release-stages';

const now = new Date('2026-11-06T12:00:00Z');
const run = (overrides: Partial<PipelineRun> = {}): PipelineRun => ({
  id: '1',
  workflowId: 'w',
  workflowName: 'Deploy',
  repository: 'org/api',
  number: 1,
  title: 'Change',
  branch: 'develop',
  commit: 'abc1234',
  event: 'push',
  actor: 'person',
  status: 'success',
  startedAt: '2026-11-06T11:50:00Z',
  finishedAt: '2026-11-06T11:58:00Z',
  durationSeconds: 480,
  url: 'u',
  ...overrides,
});
const job = (name: string, status: PipelineJob['status'], steps: PipelineJob['steps'] = []): PipelineJob => ({
  id: name,
  name,
  status,
  durationSeconds: 10,
  url: 'u',
  steps,
});
const deployment = (overrides: Partial<Deployment> = {}): Deployment => ({
  state: 'running',
  startedAt: '2026-11-06T11:57:00Z',
  finishedAt: null,
  runningTasks: 2,
  desiredTasks: 3,
  images: ['repo/api:abc1234'],
  targetLabel: 'ECS Fargate',
  traffic: null,
  ...overrides,
});
const traffic = (stage: DeploymentStageId | null, status: TrafficDeploymentStatus, rollbackReason: string | null = null) => ({
  stage,
  status,
  reason: null,
  rollbackReason,
  updatedAt: '2026-11-06T12:02:00Z',
});
const labels = (progress: ReturnType<typeof releaseProgress>) =>
  progress.stages.map(({ label, status }) => `${label}:${status}`);

describe('matching a rollout to a run', () => {
  it('prefers the commit in the image tag', () => {
    expect(matchRollout(run(), deployment({ startedAt: null }))).toBe('commit');
    expect(matchRollout(run(), deployment({ images: ['repo/api:sha-abc1234-x'] }))).toBe('commit');
  });

  it('refuses an image built from another commit, even if it started later', () => {
    expect(matchRollout(run(), deployment({ images: ['repo/api:def5678'] }))).toBeNull();
  });

  it('uses the time for tags that are not commits', () => {
    expect(matchRollout(run(), deployment({ images: ['repo/api:latest'] }))).toBe('time');
    expect(
      matchRollout(run(), deployment({ images: ['repo/api:latest'], startedAt: '2026-11-06T11:00:00Z' })),
    ).toBeNull();
  });
});

describe('release progress', () => {
  it('shows a pipeline in progress, with only the stages it has', () => {
    const progress = releaseProgress(
      run({ status: 'running', finishedAt: null }),
      [job('build', 'success'), job('unit-tests', 'running'), job('deploy', 'queued')],
      deployment({ state: 'succeeded', images: ['repo/api:old1234'] }),
      now,
    );
    expect(progress.state).toBe('building');
    expect(labels(progress)).toEqual([
      'Build:success',
      'Test:running',
      'ECS Fargate:waiting',
      'Ready:waiting',
    ]);
  });

  it('reads the steps of a single-job pipeline and ignores housekeeping steps', () => {
    const step = (name: string, status: PipelineJob['status']) => ({
      number: 1,
      name,
      status,
      durationSeconds: 1,
    });
    const progress = releaseProgress(
      run({ status: 'running', finishedAt: null }),
      [
        job('deploy', 'running', [
          step('Set up job', 'success'),
          step('Install', 'success'),
          step('Build and push image', 'running'),
          step('Update ECS service', 'queued'),
          step('Post checkout', 'queued'),
          step('Complete job', 'queued'),
        ]),
      ],
      null,
      now,
    );
    expect(labels(progress)).toEqual([
      'Build:success',
      'Image:running',
      'Deploy:waiting',
      'Ready:waiting',
    ]);
  });

  it('follows the rollout once the pipeline has finished', () => {
    const progress = releaseProgress(run(), [job('build', 'success')], deployment(), now);
    expect(progress).toMatchObject({ state: 'deploying', matchedBy: 'commit', readyAt: null });
    expect(progress.stages.at(-2)).toMatchObject({ status: 'running', detail: '2 of 3 tasks' });
  });

  it('is ready when the rollout completes', () => {
    const finishedAt = '2026-11-06T11:59:00Z';
    const progress = releaseProgress(
      run(),
      [job('build', 'success')],
      deployment({ state: 'succeeded', runningTasks: 3, finishedAt }),
      now,
    );
    expect(progress).toMatchObject({ state: 'ready', readyAt: finishedAt });
    expect(labels(progress).slice(-2)).toEqual(['ECS Fargate:success', 'Ready:success']);
  });

  it('reports a failed rollout', () => {
    const progress = releaseProgress(run(), [], deployment({ state: 'failed' }), now);
    expect(progress.state).toBe('failed');
    expect(progress.stages.at(-2)).toMatchObject({ status: 'failure', detail: 'Rollout failed' });
    expect(progress.stages.at(-1)).toMatchObject({ status: 'waiting' });
  });

  it('stops at a failed or cancelled pipeline', () => {
    const failed = releaseProgress(run({ status: 'failure' }), [job('tests', 'failure')], null, now);
    expect(failed.state).toBe('failed');
    expect(labels(failed)).toEqual(['Test:failure', 'Deploy:waiting', 'Ready:waiting']);
    expect(releaseProgress(run({ status: 'cancelled' }), [], null, now).state).toBe('cancelled');
  });

  it('shows jobs skipped after a failure as skipped, not done', () => {
    const progress = releaseProgress(
      run({ status: 'failure' }),
      [job('tests', 'failure'), job('push-image', 'skipped'), job('deploy', 'skipped')],
      null,
      now,
    );
    expect(progress.stages[1]).toMatchObject({ label: 'Image', status: 'waiting', detail: 'Skipped' });
    expect(progress.stages[2]).toMatchObject({ label: 'Deploy', status: 'waiting', detail: 'Skipped' });
  });

  it('ignores a skipped job in a stage that otherwise ran', () => {
    const progress = releaseProgress(
      run(),
      [job('build', 'success'), job('build-docs', 'skipped')],
      deployment(),
      now,
    );
    expect(progress.stages[0]).toMatchObject({ label: 'Build', status: 'success' });
  });

  it('never calls a failed pipeline ready because of an older rollout', () => {
    const progress = releaseProgress(
      run({ status: 'failure' }),
      [],
      deployment({ state: 'succeeded' }),
      now,
    );
    expect(progress.state).toBe('failed');
  });

  it('waits for a rollout, then says none was seen', () => {
    const older = deployment({ images: ['repo/api:def5678'] });
    expect(releaseProgress(run(), [], older, now).state).toBe('deploying');
    const late = releaseProgress(run({ finishedAt: '2026-11-06T11:00:00Z' }), [], older, now);
    expect(late.state).toBe('not_deployed');
    expect(late.stages.at(-2)).toMatchObject({ detail: 'No rollout seen' });
  });

  it('handles a pipeline that has never run', () => {
    expect(releaseProgress(null, [], null, now).state).toBe('idle');
  });
});

describe('blue/green releases', () => {
  const bg = (stage: DeploymentStageId | null, status: TrafficDeploymentStatus, rollbackReason: string | null = null) =>
    deployment({
      targetLabel: 'ECS Fargate blue/green',
      state: status === 'succeeded' ? 'succeeded' : status === 'rolled-back' ? 'failed' : 'running',
      traffic: traffic(stage, status, rollbackReason),
    });
  const progressOf = (rollout: Deployment) => releaseProgress(run(), [], rollout, now);

  it('is deploying while green scales up', () => {
    const progress = progressOf(bg('scale-up', 'in-progress'));
    expect(progress.state).toBe('deploying');
    expect(labels(progress).slice(-3)).toEqual(['ECS Fargate blue/green:running', 'Ready:waiting', 'Live:waiting']);
  });

  it('is ready for testing once green has test traffic, before production moves', () => {
    const progress = progressOf(bg('test-traffic', 'in-progress'));
    expect(progress).toMatchObject({ state: 'ready', readyAt: '2026-11-06T12:02:00Z' });
    expect(labels(progress).slice(-2)).toEqual(['Ready:success', 'Live:waiting']);
    expect(progress.stages.at(-2)?.detail).toBe('Green has test traffic');
  });

  it('shows production moving and bake time on the way to live', () => {
    expect(labels(progressOf(bg('bake-time', 'in-progress'))).at(-1)).toBe('Live:running');
    expect(progressOf(bg('bake-time', 'in-progress')).stages.at(-1)?.detail).toBe('Bake time');
    expect(labels(progressOf(bg('clean-up', 'succeeded', null))).slice(-2)).toEqual(['Ready:success', 'Live:success']);
  });

  it('shows a rollback with its reason', () => {
    const progress = progressOf(bg('production-traffic', 'rolled-back', 'Alarm fired'));
    expect(progress.state).toBe('failed');
    expect(progress.stages.at(-3)).toMatchObject({ status: 'failure', detail: 'Rolled back: Alarm fired' });
    expect(labels(progress).at(-1)).toBe('Live:failure');
  });
});
