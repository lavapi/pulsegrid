import type { PipelineRun, PipelineSummary } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { activityOf } from './pipeline-activity';

const NOW = new Date('2026-11-06T12:00:00Z');
const app = { id: 'a1', name: 'Payments', repository: 'o/r', connectionId: 'c1' };

const summary = (name: string, run: Partial<PipelineRun> | null) =>
  ({
    appId: 'a1',
    repository: 'o/r',
    workflowId: name,
    name,
    environmentName: 'Staging',
    latestRun: run && { startedAt: null, finishedAt: null, ...run },
  }) as PipelineSummary;

const names = (items: { name: string }[]) => items.map(({ name }) => name);

describe('activityOf', () => {
  it('splits running and queued runs from failures', () => {
    const { running, failed } = activityOf(
      [
        summary('Build', { status: 'running', startedAt: '2026-11-06T11:00:00Z' }),
        summary('Deploy', { status: 'queued', startedAt: '2026-11-06T11:30:00Z' }),
        summary('Test', { status: 'failure', finishedAt: '2026-11-06T10:00:00Z' }),
        summary('Lint', { status: 'success', finishedAt: '2026-11-06T10:00:00Z' }),
        summary('Idle', null),
      ],
      [app],
      NOW,
    );
    expect(names(running)).toEqual(['Deploy', 'Build']);
    expect(names(failed)).toEqual(['Test']);
    expect(running[0]).toMatchObject({ appName: 'Payments', environmentName: 'Staging' });
  });

  it('leaves out failures older than a day', () => {
    const old = summary('Old', { status: 'failure', finishedAt: '2026-11-05T11:59:00Z' });
    expect(activityOf([old], [app], NOW).failed).toEqual([]);
  });

  it('falls back to the repository when the app is gone', () => {
    const { running } = activityOf([summary('Build', { status: 'running' })], [], NOW);
    expect(running[0]?.appName).toBe('o/r');
  });
});
