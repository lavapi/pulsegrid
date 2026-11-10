import type { PipelineDefinition, PipelineRun } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import {
  environmentOfRun,
  pipelineEnvironments,
  type PipelineContext,
  protectionFor,
  runsFor,
  toPipelineSummary,
} from './pipeline-summaries';

const STAGING = { id: 'staging-id', name: 'Staging', production: false };
const PRODUCTION = { id: 'production-id', name: 'Production', production: true };
const RULE = { branch: 'main', matched: 'production', otherwise: 'staging' };

const definition = (overrides: Partial<PipelineDefinition> = {}): PipelineDefinition => ({
  manual: true,
  inputs: [],
  environments: [],
  environmentRule: null,
  opaqueEnvironment: false,
  ...overrides,
});

const context = (overrides: Partial<PipelineContext> = {}): PipelineContext => ({
  appId: 'app',
  workflow: { id: '1', repository: 'o/r', name: 'Deploy', path: 'p', url: 'u' },
  definition: definition(),
  links: [],
  environments: [STAGING, PRODUCTION],
  ...overrides,
});

const routed = (overrides: Partial<PipelineContext> = {}) =>
  context({
    definition: definition({ environmentRule: RULE, environments: ['production', 'staging'] }),
    ...overrides,
  });

const run = (id: string, branch: string) => ({ id, branch, workflowId: '1' }) as PipelineRun;

describe('branch-routed pipelines', () => {
  const runs = [run('1', 'dev'), run('2', 'main'), run('3', 'feature/x')];

  it('belong to both environments', () => {
    expect(pipelineEnvironments(routed()).map(({ name }) => name)).toEqual(['Production', 'Staging']);
  });

  it('show only the runs for the selected environment', () => {
    expect(runsFor(routed(), runs, STAGING).map(({ id }) => id)).toEqual(['1', '3']);
    expect(runsFor(routed(), runs, PRODUCTION).map(({ id }) => id)).toEqual(['2']);
  });

  it('use the latest run for the selected environment', () => {
    expect(toPipelineSummary(routed(), runs, PRODUCTION)).toMatchObject({
      environmentName: 'Production',
      production: true,
      latestRun: { id: '2' },
    });
    expect(toPipelineSummary(routed(), runs, STAGING)).toMatchObject({
      environmentName: 'Staging',
      production: false,
      latestRun: { id: '1' },
    });
  });

  it('name the environment of a run', () => {
    expect(environmentOfRun(routed(), run('1', 'main'))).toBe('Production');
    expect(environmentOfRun(routed(), run('1', 'dev'))).toBe('Staging');
  });

  it('protect by branch', () => {
    expect(protectionFor(routed(), { branch: 'main' })).toEqual({
      production: true,
      label: 'Production',
    });
    expect(protectionFor(routed(), { branch: 'dev' }).production).toBe(false);
  });

  it('count as production when the target is unknown', () => {
    expect(protectionFor(routed()).production).toBe(true);
  });

  it('cannot be downgraded by a link', () => {
    const linked = routed({
      links: [{ repository: 'o/r', workflowId: '1', environmentId: STAGING.id }],
    });
    expect(protectionFor(linked, { branch: 'main' }).production).toBe(true);
    expect(protectionFor(linked).production).toBe(true);
  });

  it('use the rule name when the dashboard has no such environment', () => {
    const only = routed({ environments: [STAGING] });
    expect(protectionFor(only, { branch: 'main' })).toEqual({
      production: true,
      label: 'production',
    });
  });
});

describe('protectionFor', () => {
  it('treats an unknown environment expression as production, even when linked', () => {
    const linked = context({
      definition: definition({ opaqueEnvironment: true }),
      links: [{ repository: 'o/r', workflowId: '1', environmentId: STAGING.id }],
    });
    expect(protectionFor(linked).production).toBe(true);
  });

  it('treats no environment as production', () => {
    expect(protectionFor(context())).toEqual({ production: true, label: 'Deploy' });
  });

  it('does not downgrade a fixed production file with a link', () => {
    const linked = context({
      definition: definition({ environments: ['production'] }),
      links: [{ repository: 'o/r', workflowId: '1', environmentId: STAGING.id }],
    });
    expect(protectionFor(linked).production).toBe(true);
  });

  it('keeps a workflow named for production protected when linked elsewhere', () => {
    const linked = context({
      workflow: { id: '1', repository: 'o/r', name: 'Deploy production', path: 'p', url: 'u' },
      links: [{ repository: 'o/r', workflowId: '1', environmentId: STAGING.id }],
    });
    expect(protectionFor(linked).production).toBe(true);
  });

  it('follows the production flag rather than the environment name', () => {
    const renamed = { id: 'renamed-id', name: 'Stage', production: true };
    const linked = context({
      environments: [STAGING, renamed],
      links: [{ repository: 'o/r', workflowId: '1', environmentId: renamed.id }],
    });
    expect(protectionFor(linked)).toEqual({ production: true, label: 'Stage' });
  });

  it('follows the production flag for branch routed pipelines', () => {
    const flagged = { ...STAGING, production: true };
    expect(protectionFor(routed({ environments: [flagged, PRODUCTION] }), { branch: 'develop' }).production).toBe(
      true,
    );
  });

  it('allows a real staging pipeline', () => {
    const staging = context({ definition: definition({ environments: ['staging'] }) });
    expect(protectionFor(staging)).toEqual({ production: false, label: 'Staging' });
  });
});
