import type { PipelineStatus, PipelineSummary } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { toAppSummary } from './pipeline-apps';

const summary = (repository: string, status: PipelineStatus | null) =>
  ({ repository, latestRun: status ? { status } : null }) as PipelineSummary;

describe('toAppSummary', () => {
  const app = { id: '1', name: 'Backend', repository: 'org/backend', connectionId: 'c' };

  it('counts only the pipelines of its repository', () => {
    const pipelines = [
      summary('org/backend', 'running'),
      summary('org/backend', 'failure'),
      summary('org/backend', 'success'),
      summary('org/backend', null),
      summary('org/other', 'failure'),
    ];
    expect(toAppSummary(app, pipelines, [])).toEqual({
      ...app,
      pipelines: 4,
      running: 1,
      failed: 1,
      deployments: [],
    });
  });

  it('handles an app with no pipelines', () => {
    expect(toAppSummary(app, [], [])).toEqual({
      ...app,
      pipelines: 0,
      running: 0,
      failed: 0,
      deployments: [],
    });
  });
});
