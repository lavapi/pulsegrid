import { describe, expect, it } from 'vitest';
import { type ComparableResource, compareResources, comparisonKey } from './environment-comparison';

const resource = (
  name: string,
  overrides: Partial<ComparableResource> = {},
): ComparableResource => ({
  id: name,
  type: 'rds-instance',
  name,
  status: 'available',
  health: 'healthy',
  details: { engine: 'postgres', engineVersion: '16.1', instanceClass: 'db.t4g.small' },
  ...overrides,
});

describe('comparisonKey', () => {
  it.each([
    ['api-staging', 'api'],
    ['api-prod', 'api'],
    ['staging-api', 'api'],
    ['prod_api_1', 'api-1'],
    ['Api-Production', 'api'],
    ['my.dev.bucket', 'my-bucket'],
  ])('reduces %s to %s', (name, key) => {
    expect(comparisonKey(name)).toBe(key);
  });

  it('ignores account IDs so buckets line up', () => {
    expect(comparisonKey('acme-staging-media-123456789012')).toBe('acme-media');
    expect(comparisonKey('acme-production-media-210987654321')).toBe('acme-media');
    expect(comparisonKey('tfstate-123456789012')).toBe('tfstate');
  });

  it('keeps shorter numbers', () => {
    expect(comparisonKey('postgres-1')).toBe('postgres-1');
    expect(comparisonKey('build-20261104')).toBe('build-20261104');
  });

  it('keeps words that only contain an environment name', () => {
    expect(comparisonKey('product-api')).toBe('product-api');
    expect(comparisonKey('devices')).toBe('devices');
    expect(comparisonKey('latest')).toBe('latest');
  });

  it('keeps the name when nothing else would remain', () => {
    expect(comparisonKey('prod')).toBe('prod');
  });

  it('removes custom environment names', () => {
    expect(comparisonKey('api-eu.blue', ['eu.blue'])).toBe('api');
  });
});

describe('compareResources', () => {
  it('matches the same resource across environments', () => {
    const [row] = compareResources([resource('db-staging')], [resource('db-prod')]);
    expect(row).toMatchObject({ key: 'db', state: 'same', differences: [] });
  });

  it('reports configuration differences', () => {
    const [row] = compareResources(
      [resource('db-staging')],
      [resource('db-prod', { details: { engine: 'postgres', engineVersion: '17.2', instanceClass: 'db.t4g.small' } })],
    );
    expect(row?.state).toBe('different');
    expect(row?.differences).toEqual([{ field: 'engineVersion', left: '16.1', right: '17.2' }]);
  });

  it('reports a missing value clearly', () => {
    const [row] = compareResources(
      [resource('db-staging', { details: { multiAz: true } })],
      [resource('db-prod', { details: {} })],
    );
    expect(row?.differences).toContainEqual({ field: 'multiAz', left: 'true', right: 'Not set' });
  });

  it('finds resources in only one environment', () => {
    const rows = compareResources([resource('only-here')], [resource('only-there')]);
    expect(rows.map(({ state }) => state).sort()).toEqual(['only_left', 'only_right']);
  });

  it('does not match different types with the same name', () => {
    const rows = compareResources([resource('api')], [resource('api', { type: 'ec2-instance' })]);
    expect(rows.map(({ state }) => state).sort()).toEqual(['only_left', 'only_right']);
  });

  it('compares cache groups, not their numbered nodes', () => {
    const node = (name: string, replicationGroup?: string) =>
      resource(name, { type: 'elasticache-cluster', details: { replicationGroup } });
    const rows = compareResources(
      [node('valkey-staging-001', 'valkey-staging'), node('solo-staging')],
      [node('valkey-prod-0001-001', 'valkey-prod'), node('valkey-prod-0001-002', 'valkey-prod')],
    );
    expect(rows.map(({ key }) => key)).toEqual(['solo']);
  });

  it('keeps extra resources that share a name', () => {
    const rows = compareResources([resource('api-prod'), resource('prod-api')], [resource('api-staging')]);
    expect(rows.map(({ state }) => state).sort()).toEqual(['only_left', 'same']);
  });
});
