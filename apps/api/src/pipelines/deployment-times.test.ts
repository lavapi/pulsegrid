import type { PipelineDefinition, PipelineRun, PipelineStatus } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { averageDeployments, deploymentsOf } from './deployment-times';
import type { PipelineContext } from './pipeline-summaries';

const STAGING = { id: 's', name: 'Staging' };
const PRODUCTION = { id: 'p', name: 'Production' };

const definition = (overrides: Partial<PipelineDefinition>): PipelineDefinition => ({
  manual: false,
  inputs: [],
  environments: [],
  environmentRule: null,
  opaqueEnvironment: false,
  ...overrides,
});

const context = (overrides: Partial<PipelineDefinition>): PipelineContext => ({
  appId: 'app',
  workflow: { id: '1', repository: 'o/r', name: 'Build', path: 'p', url: 'u' },
  definition: definition(overrides),
  links: [],
  environments: [STAGING, PRODUCTION],
});

const run = (branch: string, durationSeconds: number | null, status: PipelineStatus = 'success') =>
  ({ branch, durationSeconds, status, workflowId: '1' }) as PipelineRun;

describe('deploymentsOf', () => {
  const routed = context({
    environmentRule: { branch: 'main', matched: 'production', otherwise: 'staging' },
  });

  it('places each run in the environment of its branch', () => {
    expect(deploymentsOf(routed, [run('main', 100), run('dev', 40)])).toEqual([
      { environmentName: 'Production', durationSeconds: 100 },
      { environmentName: 'Staging', durationSeconds: 40 },
    ]);
  });

  it('uses the environment of a fixed pipeline', () => {
    const fixed = context({ environments: ['staging'] });
    expect(deploymentsOf(fixed, [run('feature', 30)])).toEqual([
      { environmentName: 'Staging', durationSeconds: 30 },
    ]);
  });

  it('skips failed, cancelled and unfinished runs', () => {
    const runs = [run('main', 10, 'failure'), run('main', 10, 'cancelled'), run('main', null, 'running')];
    expect(deploymentsOf(routed, runs)).toEqual([]);
  });

  it('skips shared pipelines', () => {
    expect(deploymentsOf(context({}), [run('main', 10)])).toEqual([]);
  });
});

describe('averageDeployments', () => {
  it('averages across workflows and puts production last', () => {
    const deployments = [
      { environmentName: 'Production', durationSeconds: 100 },
      { environmentName: 'Production', durationSeconds: 201 },
      { environmentName: 'Staging', durationSeconds: 40 },
    ];
    expect(averageDeployments(deployments, [PRODUCTION, STAGING])).toEqual([
      { environmentName: 'Staging', averageSeconds: 40, runs: 1 },
      { environmentName: 'Production', averageSeconds: 151, runs: 2 },
    ]);
  });

  it('shows environments with no deployments', () => {
    expect(averageDeployments([], [PRODUCTION])).toEqual([
      { environmentName: 'Production', averageSeconds: null, runs: 0 },
    ]);
  });
});
