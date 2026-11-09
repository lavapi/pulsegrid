import { describe, expect, it } from 'vitest';
import { parseWorkflowDefinition } from './workflow-definition';

describe('parseWorkflowDefinition', () => {
  it('reads manual inputs', () => {
    const definition = parseWorkflowDefinition(`
name: Deploy
on:
  workflow_dispatch:
    inputs:
      tag:
        description: Version
        required: true
      target:
        type: choice
        options: [blue, green]
        default: blue
      dry:
        type: boolean
        default: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
`);
    expect(definition.manual).toBe(true);
    expect(definition.environments).toEqual(['production']);
    expect(definition.inputs).toEqual([
      { name: 'tag', description: 'Version', required: true, type: 'string', defaultValue: null, options: [] },
      { name: 'target', description: null, required: false, type: 'choice', defaultValue: 'blue', options: ['blue', 'green'] },
      { name: 'dry', description: null, required: false, type: 'boolean', defaultValue: 'true', options: [] },
    ]);
  });

  it.each([
    ['on: workflow_dispatch', true],
    ['on: [push, workflow_dispatch]', true],
    ['on:\n  workflow_dispatch:', true],
    ['on: push', false],
    ['on: [push, pull_request]', false],
    ['on:\n  push:\n    branches: [main]', false],
  ])('reads %j', (yaml, manual) => {
    expect(parseWorkflowDefinition(`${yaml}\njobs: {}`).manual).toBe(manual);
  });

  it('reads environment objects and ignores expressions', () => {
    const { environments } = parseWorkflowDefinition(`
on: push
jobs:
  one:
    environment:
      name: staging
      url: https://example.test
  two:
    environment: \${{ inputs.target }}
  three:
    environment: staging
`);
    expect(environments).toEqual(['staging']);
  });

  it('treats broken files as not runnable', () => {
    expect(parseWorkflowDefinition('on: [unclosed').manual).toBe(false);
    expect(parseWorkflowDefinition('').manual).toBe(false);
  });

  describe('branch-based environments', () => {
    const withEnvironment = (expression: string) =>
      parseWorkflowDefinition(`on: push\njobs:\n  deploy:\n    environment: ${expression}\n`);

    it('reads the branch rule used by deploy workflows', () => {
      const definition = withEnvironment("\${{ github.ref_name == 'main' && 'production' || 'staging' }}");
      expect(definition.environmentRule).toEqual({ branch: 'main', matched: 'production', otherwise: 'staging' });
      expect(definition.environments).toEqual(['production', 'staging']);
      expect(definition.opaqueEnvironment).toBe(false);
    });

    it('reads the full ref form', () => {
      const definition = withEnvironment("\${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}");
      expect(definition.environmentRule?.branch).toBe('main');
    });

    it('marks anything else as unknown', () => {
      const definition = withEnvironment('\${{ matrix.environment }}');
      expect(definition.opaqueEnvironment).toBe(true);
      expect(definition.environmentRule).toBeNull();
    });

    it('treats a rule mixed with a fixed environment as unknown', () => {
      const definition = parseWorkflowDefinition(`on: push
jobs:
  one:
    environment: \${{ github.ref_name == 'main' && 'production' || 'staging' }}
  two:
    environment: qa
`);
      expect(definition.environmentRule).toBeNull();
      expect(definition.opaqueEnvironment).toBe(true);
    });
  });
});
