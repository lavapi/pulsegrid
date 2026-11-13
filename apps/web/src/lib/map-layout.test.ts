import type { InfrastructureMap, MapNode } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';
import { connectionsOf, filterMap, flattenLayout, toElkGraph } from './map-layout';

const node = (id: string, category: MapNode['category'], groupId: string | null): MapNode => ({
  id,
  category,
  typeLabel: id,
  name: id,
  awsName: null,
  status: '',
  health: 'healthy',
  groupId,
  href: null,
});

const map: InfrastructureMap = {
  groups: [
    { id: 'vpc:a', kind: 'vpc', label: 'a', parentId: null },
    { id: 'vpc:a:private', kind: 'private', label: 'Private', parentId: 'vpc:a' },
    { id: 'vpc:b', kind: 'vpc', label: 'b', parentId: null },
  ],
  nodes: [
    node('internet', 'internet', null),
    node('lb', 'load-balancing', 'vpc:a:private'),
    node('db', 'rds', 'vpc:a:private'),
    node('other', 'ec2', 'vpc:b'),
    node('s3', 's3', null),
  ],
  edges: [
    { id: 'one', source: 'internet', target: 'lb', kind: 'exact', label: null },
    { id: 'two', source: 'lb', target: 'db', kind: 'allowed', label: '5432' },
  ],
  truncated: false,
};

describe('filterMap', () => {
  it('keeps one VPC and drops other networks', () => {
    const result = filterMap(map, { vpcId: 'vpc:a', hiddenCategories: [] });
    expect(result.nodes.map(({ id }) => id)).toEqual(['internet', 'lb', 'db']);
    expect(result.groups.map(({ id }) => id)).toEqual(['vpc:a', 'vpc:a:private']);
  });

  it('removes lines to hidden services, and the internet when nothing uses it', () => {
    const result = filterMap(map, { vpcId: '', hiddenCategories: ['load-balancing'] });
    expect(result.edges).toEqual([]);
    expect(result.nodes.map(({ id }) => id)).toEqual(['db', 'other', 's3']);
  });
});

describe('toElkGraph', () => {
  it('nests resources inside their groups', () => {
    const graph = toElkGraph(map);
    const vpc = graph.children?.find(({ id }) => id === 'vpc:a');
    expect(vpc?.children?.[0]?.id).toBe('vpc:a:private');
    expect(vpc?.children?.[0]?.children?.map(({ id }) => id)).toEqual(['lb', 'db']);
    expect(graph.children?.map(({ id }) => id)).toEqual(['vpc:a', 'vpc:b', 'internet', 's3']);
  });
});

describe('flattenLayout', () => {
  it('lists parents before children, with positions relative to the parent', () => {
    const items = flattenLayout({
      id: 'root',
      children: [{ id: 'g', x: 1, y: 2, width: 9, height: 9, children: [{ id: 'n', x: 3, y: 4 }] }],
    });
    expect(items.map(({ id, parentId, x }) => [id, parentId, x])).toEqual([
      ['g', null, 1],
      ['n', 'g', 3],
    ]);
  });
});

describe('connectionsOf', () => {
  it('finds lines on either side', () => {
    expect(connectionsOf(map.edges, 'lb').map(({ id }) => id)).toEqual(['one', 'two']);
  });
});
