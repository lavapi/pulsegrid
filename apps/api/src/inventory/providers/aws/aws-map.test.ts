import { describe, expect, it } from 'vitest';
import type { MapResource } from '../provider';
import { buildAwsMap } from './aws-map';

let nextId = 0;
const resource = (
  type: MapResource['type'],
  nativeId: string,
  details: Record<string, unknown> = {},
  name = nativeId,
): MapResource => ({
  id: `id-${(nextId += 1)}`,
  type,
  nativeId,
  name,
  status: 'ok',
  health: 'healthy',
  region: 'eu-central-1',
  details,
});

const vpc = resource('vpc', 'vpc-1', {}, 'main');
const publicSubnet = resource('subnet', 'subnet-a', { vpcId: 'vpc-1', public: true });
const privateSubnet = resource('subnet', 'subnet-b', { vpcId: 'vpc-1', public: false });
const balancer = resource('load-balancer', 'lb', {
  vpcId: 'vpc-1',
  scheme: 'internet-facing',
  subnetIds: ['subnet-a'],
  targetGroups: ['tg-1'],
  targetInstances: ['i-1'],
  securityGroups: ['sg-lb'],
});
const service = resource('ecs-service', 'svc', {
  subnetIds: ['subnet-b'],
  targetGroups: ['tg-1'],
  securityGroups: ['sg-app'],
});
const database = resource('rds-instance', 'db', {
  vpcId: 'vpc-1',
  subnetIds: ['subnet-a', 'subnet-b'],
  securityGroups: ['sg-db'],
});
const appGroup = resource('security-group', 'sg-app', {
  allowedFrom: [{ groupId: 'sg-lb', fromPort: 80, toPort: 80 }],
});
const dbGroup = resource('security-group', 'sg-db', {
  allowedFrom: [{ groupId: 'sg-app', fromPort: 5432, toPort: 5432 }],
});

const base = [vpc, publicSubnet, privateSubnet, balancer, service, database, appGroup, dbGroup];
const nodeNames = (resources: MapResource[]) =>
  buildAwsMap(resources).nodes.map(({ name }) => name);

describe('buildAwsMap', () => {
  it('places resources in their VPC and subnet tier', () => {
    const { groups, nodes } = buildAwsMap(base);
    expect(groups).toEqual(
      expect.arrayContaining([
        { id: 'vpc:vpc-1', kind: 'vpc', label: 'main · eu-central-1', parentId: null },
        { id: 'vpc:vpc-1:public', kind: 'public', label: 'Public subnets', parentId: 'vpc:vpc-1' },
        { id: 'vpc:vpc-1:private', kind: 'private', label: 'Private subnets', parentId: 'vpc:vpc-1' },
      ]),
    );
    expect(nodes.find(({ name }) => name === 'lb')?.groupId).toBe('vpc:vpc-1:public');
    expect(nodes.find(({ name }) => name === 'svc')?.groupId).toBe('vpc:vpc-1:private');
  });

  it('treats a resource spanning public and private subnets as private', () => {
    const { nodes } = buildAwsMap(base);
    expect(nodes.find(({ name }) => name === 'db')?.groupId).toBe('vpc:vpc-1:private');
  });

  it('links the internet, load balancer and service as exact', () => {
    const { edges } = buildAwsMap(base);
    expect(edges.filter(({ kind }) => kind === 'exact').map(({ source, target }) => [source, target])).toEqual([
      ['internet', balancer.id],
      [balancer.id, service.id],
    ]);
  });

  it('marks security group links as allowed, with the port', () => {
    const { edges } = buildAwsMap(base);
    expect(edges.filter(({ kind }) => kind === 'allowed')).toEqual([
      {
        id: `allowed:${service.id}:${database.id}`,
        source: service.id,
        target: database.id,
        kind: 'allowed',
        label: '5432',
      },
    ]);
  });

  it('prefers an exact link over an allowed one', () => {
    const machine = resource('ec2-instance', 'i-1', { vpcId: 'vpc-1', securityGroups: ['sg-app'] });
    const direct = resource('ec2-instance', 'i-2', { vpcId: 'vpc-1', securityGroups: ['sg-peer'] });
    const group = resource('security-group', 'sg-peer', {
      allowedFrom: [{ groupId: 'sg-app' }],
    });
    const { edges } = buildAwsMap([...base, machine, direct, group]);
    expect(edges.filter(({ target }) => target === machine.id)).toHaveLength(1);
    expect(edges.find(({ target }) => target === direct.id)?.label).toBe('All ports');
  });

  it('shows a cluster once, using the network of its members', () => {
    const cluster = resource('rds-cluster', 'aurora', { securityGroups: ['sg-db'] }, 'aurora');
    const member = resource('rds-instance', 'writer', {
      cluster: 'aurora',
      vpcId: 'vpc-1',
      subnetIds: ['subnet-b'],
    });
    const { nodes } = buildAwsMap([...base, cluster, member]);
    expect(nodes.map(({ name }) => name)).toContain('aurora');
    expect(nodes.map(({ name }) => name)).not.toContain('writer');
    expect(nodes.find(({ name }) => name === 'aurora')?.groupId).toBe('vpc:vpc-1:private');
  });

  it('combines S3 buckets into one node, using the worst health', () => {
    const buckets = [resource('s3-bucket', 'a'), { ...resource('s3-bucket', 'b'), health: 'degraded' as const }];
    const node = buildAwsMap(buckets).nodes[0];
    expect(node).toMatchObject({ status: '2 buckets', health: 'degraded', href: '/infrastructure/s3', groupId: null });
  });

  it('hides networks and clusters that are not on the map', () => {
    expect(nodeNames([vpc, publicSubnet, resource('ecs-cluster', 'c'), appGroup])).toEqual([]);
  });

  it('adds the internet only when something is reachable from it', () => {
    const internal = resource('load-balancer', 'inner', { scheme: 'internal' });
    expect(nodeNames([internal])).toEqual(['inner']);
  });

  it('keeps resources it cannot place, such as data from an older sync', () => {
    const old = resource('ecs-service', 'old');
    expect(buildAwsMap([old]).nodes[0]?.groupId).toBeNull();
  });

  it('flags open public machines, but not private ones', () => {
    const group = resource('security-group', 'sg-open', { openToInternet: true });
    const open = resource('ec2-instance', 'open', { publicIp: '1.2.3.4', securityGroups: ['sg-open'] });
    const closed = resource('ec2-instance', 'closed', { securityGroups: ['sg-open'] });
    const { edges } = buildAwsMap([group, open, closed]);
    expect(edges.map(({ target, kind }) => [target, kind])).toEqual([[open.id, 'allowed']]);
  });
});
