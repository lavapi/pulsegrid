import {
  categoryOf,
  type InfrastructureMap,
  INTERNET_NODE_ID,
  type MapEdge,
  type MapEdgeKind,
  type MapGroup,
  type MapNode,
  type ResourceHealth,
  resourcePath,
  SERVICE_CATEGORIES,
  type ResourceType,
} from '@pulsegrid/shared';
import type { MapResource } from '../provider';

interface Network {
  vpcId: string | undefined;
  subnetIds: string[];
  securityGroups: string[];
}

interface AllowedSource {
  groupId: string;
  fromPort?: number;
  toPort?: number;
}

const SOURCE_TYPES: readonly ResourceType[] = ['ecs-service', 'ec2-instance'];
const TARGET_TYPES: readonly ResourceType[] = [
  'ecs-service',
  'ec2-instance',
  'rds-cluster',
  'rds-instance',
  'elasticache-replication-group',
  'elasticache-cluster',
];
const HEALTH_ORDER: readonly ResourceHealth[] = ['degraded', 'unknown', 'stopped', 'healthy'];
const S3_NODE_ID = 's3';

const strings = ({ details }: MapResource, key: string): string[] => {
  const value = details[key];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
};

const text = ({ details }: MapResource, key: string): string | undefined => {
  const value = details[key];
  return typeof value === 'string' ? value : undefined;
};

const ofType = (resources: readonly MapResource[], type: ResourceType): MapResource[] =>
  resources.filter((resource) => resource.type === type);

const membersOf = (resource: MapResource, resources: readonly MapResource[]): MapResource[] => {
  if (resource.type === 'rds-cluster') {
    return ofType(resources, 'rds-instance').filter(
      (member) => text(member, 'cluster') === resource.name,
    );
  }
  if (resource.type === 'elasticache-replication-group') {
    return ofType(resources, 'elasticache-cluster').filter(
      (member) => text(member, 'replicationGroup') === resource.name,
    );
  }
  return [];
};

const isMember = (resource: MapResource, resources: readonly MapResource[]): boolean => {
  if (resource.type === 'rds-instance') {
    return ofType(resources, 'rds-cluster').some(({ name }) => name === text(resource, 'cluster'));
  }
  if (resource.type === 'elasticache-cluster') {
    return ofType(resources, 'elasticache-replication-group').some(
      ({ name }) => name === text(resource, 'replicationGroup'),
    );
  }
  return false;
};

const unique = <Item>(items: readonly Item[]): Item[] => [...new Set(items)];

const networkOf = (resource: MapResource, resources: readonly MapResource[]): Network => {
  const all = [resource, ...membersOf(resource, resources)];
  const subnetIds = unique(
    all.flatMap((item) => [...strings(item, 'subnetIds'), text(item, 'subnetId') ?? []].flat()),
  );
  const subnets = ofType(resources, 'subnet');
  const vpcFromSubnet = subnets.find(({ nativeId }) => subnetIds.includes(nativeId));
  return {
    vpcId:
      all.flatMap((item) => text(item, 'vpcId') ?? [])[0] ??
      (vpcFromSubnet && text(vpcFromSubnet, 'vpcId')),
    subnetIds,
    securityGroups: unique(all.flatMap((item) => strings(item, 'securityGroups'))),
  };
};

const isSubnetPublic = (subnet: MapResource): boolean => {
  const { public: routed, publicIpOnLaunch } = subnet.details;
  return routed === true || (routed === undefined && publicIpOnLaunch === true);
};

const groupIdFor = (
  { vpcId, subnetIds }: Network,
  resources: readonly MapResource[],
): string | null => {
  if (!vpcId) {
    return null;
  }
  const known = ofType(resources, 'subnet').filter(({ nativeId }) => subnetIds.includes(nativeId));
  if (known.length === 0) {
    return `vpc:${vpcId}`;
  }
  return `vpc:${vpcId}:${known.every(isSubnetPublic) ? 'public' : 'private'}`;
};

const toNode = (resource: MapResource, groupId: string | null): MapNode => ({
  id: resource.id,
  category: categoryOf(resource.type),
  typeLabel: SERVICE_CATEGORIES[categoryOf(resource.type)].label,
  name: resource.name,
  status: resource.status,
  health: resource.health,
  groupId,
  href: resourcePath(resource),
});

const worstHealth = (resources: readonly MapResource[]): ResourceHealth =>
  HEALTH_ORDER.find((health) => resources.some((item) => item.health === health)) ?? 'unknown';

const bucketsNode = (buckets: readonly MapResource[]): MapNode => ({
  id: S3_NODE_ID,
  category: 's3',
  typeLabel: 'S3',
  name: 'S3 buckets',
  status: `${buckets.length} ${buckets.length === 1 ? 'bucket' : 'buckets'}`,
  health: worstHealth(buckets),
  groupId: null,
  href: '/infrastructure/s3',
});

const internetNode: MapNode = {
  id: INTERNET_NODE_ID,
  category: 'internet',
  typeLabel: 'Public traffic',
  name: 'Internet',
  status: '',
  health: 'healthy',
  groupId: null,
  href: null,
};

const vpcLabel = (vpcId: string, resources: readonly MapResource[]): string => {
  const vpc = ofType(resources, 'vpc').find(({ nativeId }) => nativeId === vpcId);
  return vpc ? `${vpc.name} · ${vpc.region}` : vpcId;
};

const groupsFor = (nodes: readonly MapNode[], resources: readonly MapResource[]): MapGroup[] => {
  const ids = unique(nodes.flatMap(({ groupId }) => groupId ?? []));
  const vpcIds = unique(ids.map((id) => id.split(':')[1] ?? ''));
  const vpcs = vpcIds.map(
    (vpcId): MapGroup => ({
      id: `vpc:${vpcId}`,
      kind: 'vpc',
      label: vpcLabel(vpcId, resources),
      parentId: null,
    }),
  );
  const tiers = ids.flatMap((id): MapGroup[] => {
    const [, vpcId, tier] = id.split(':');
    if (tier !== 'public' && tier !== 'private') {
      return [];
    }
    return [
      {
        id,
        kind: tier,
        label: tier === 'public' ? 'Public subnets' : 'Private subnets',
        parentId: `vpc:${vpcId}`,
      },
    ];
  });
  return [...vpcs, ...tiers];
};

const portLabel = ({ fromPort, toPort }: AllowedSource): string => {
  if (fromPort === undefined || fromPort < 0) {
    return 'All ports';
  }
  return fromPort === toPort || toPort === undefined ? String(fromPort) : `${fromPort}-${toPort}`;
};

const allowedSources = (group: MapResource): AllowedSource[] => {
  const value = group.details['allowedFrom'];
  return Array.isArray(value) ? (value as AllowedSource[]) : [];
};

const edge = (source: string, target: string, kind: MapEdgeKind, label: string | null): MapEdge => ({
  id: `${kind}:${source}:${target}`,
  source,
  target,
  kind,
  label,
});

const balancerEdges = (nodes: readonly MapResource[]): MapEdge[] =>
  ofType(nodes, 'load-balancer').flatMap((balancer) => {
    const targetGroups = strings(balancer, 'targetGroups');
    const instances = strings(balancer, 'targetInstances');
    const services = ofType(nodes, 'ecs-service').filter((service) =>
      strings(service, 'targetGroups').some((arn) => targetGroups.includes(arn)),
    );
    const machines = ofType(nodes, 'ec2-instance').filter(({ nativeId }) =>
      instances.includes(nativeId),
    );
    return [...services, ...machines].map(({ id }) => edge(balancer.id, id, 'exact', null));
  });

const allowedEdges = (nodes: readonly MapResource[], resources: readonly MapResource[]): MapEdge[] => {
  const groups = ofType(resources, 'security-group');
  const sources = nodes.filter(({ type }) => SOURCE_TYPES.includes(type));
  const targets = nodes.filter(({ type }) => TARGET_TYPES.includes(type));
  return targets.flatMap((target) => {
    const rules = networkOf(target, resources)
      .securityGroups.flatMap((id) => groups.filter(({ nativeId }) => nativeId === id))
      .flatMap(allowedSources);
    return sources.flatMap((source) => {
      const groupIds = networkOf(source, resources).securityGroups;
      const matching = rules.filter(({ groupId }) => groupIds.includes(groupId));
      return source.id !== target.id && matching.length > 0
        ? [edge(source.id, target.id, 'allowed', unique(matching.map(portLabel)).join(', '))]
        : [];
    });
  });
};

const isOpenToInternet = (resource: MapResource, resources: readonly MapResource[]): boolean => {
  const groupIds = networkOf(resource, resources).securityGroups;
  return ofType(resources, 'security-group').some(
    (group) => groupIds.includes(group.nativeId) && group.details['openToInternet'] === true,
  );
};

const internetEdges = (nodes: readonly MapResource[], resources: readonly MapResource[]): MapEdge[] => [
  ...ofType(nodes, 'load-balancer')
    .filter((balancer) => text(balancer, 'scheme') === 'internet-facing')
    .map(({ id }) => edge(INTERNET_NODE_ID, id, 'exact', null)),
  ...ofType(nodes, 'ec2-instance')
    .filter((machine) => text(machine, 'publicIp') && isOpenToInternet(machine, resources))
    .map(({ id }) => edge(INTERNET_NODE_ID, id, 'allowed', null)),
];

const withoutAllowedDuplicates = (edges: readonly MapEdge[]): MapEdge[] =>
  edges.filter(
    (item) =>
      item.kind === 'exact' ||
      !edges.some(
        (other) =>
          other.kind === 'exact' && other.source === item.source && other.target === item.target,
      ),
  );

const MAPPED_TYPES: readonly ResourceType[] = ['load-balancer', ...TARGET_TYPES];

export const buildAwsMap = (resources: readonly MapResource[]): InfrastructureMap => {
  const placed = resources.filter(
    (resource) => MAPPED_TYPES.includes(resource.type) && !isMember(resource, resources),
  );
  const nodes = placed.map((resource) =>
    toNode(resource, groupIdFor(networkOf(resource, resources), resources)),
  );
  const buckets = ofType(resources, 's3-bucket');
  const edges = withoutAllowedDuplicates([
    ...internetEdges(placed, resources),
    ...balancerEdges(placed),
    ...allowedEdges(placed, resources),
  ]);
  return {
    groups: groupsFor(nodes, resources),
    nodes: [
      ...(edges.some(({ source }) => source === INTERNET_NODE_ID) ? [internetNode] : []),
      ...nodes,
      ...(buckets.length > 0 ? [bucketsNode(buckets)] : []),
    ],
    edges,
    truncated: false,
  };
};
