import type { ResourceHealth, ResourceType } from '@pulsegrid/shared';

export interface DemoResource {
  type: ResourceType;
  service: string;
  nativeId: string;
  name: string;
  status: string;
  health: ResourceHealth;
  tags: Record<string, string>;
  details: Record<string, unknown>;
}

export interface DemoStack {
  stage: string;
  accountId: string;
  region: string;
  cidrPrefix: string;
  appTasks: number;
  deploying: string | null;
}

const arn = (stack: DemoStack, service: string, path: string): string =>
  `arn:aws:${service}:${stack.region}:${stack.accountId}:${path}`;

const shortId = (stack: DemoStack, kind: string, index: number): string =>
  `${kind}-0${stack.cidrPrefix.split('.')[1]}${index}a7c3e9f1d2b4`;

const tagsOf = (stack: DemoStack, extra: Record<string, string> = {}): Record<string, string> => ({
  Environment: stack.stage,
  Project: 'acme',
  ...extra,
});

const network = (stack: DemoStack) => {
  const vpcId = shortId(stack, 'vpc', 0);
  const zones = ['a', 'b'].map((zone) => `${stack.region}${zone}`);
  const subnets = [
    ...zones.map((zone, index) => ({ id: shortId(stack, 'subnet', index + 1), zone, isPublic: true, index })),
    ...zones.map((zone, index) => ({ id: shortId(stack, 'subnet', index + 3), zone, isPublic: false, index: index + 2 })),
  ];
  const groups = {
    balancer: shortId(stack, 'sg', 1),
    app: shortId(stack, 'sg', 2),
    database: shortId(stack, 'sg', 3),
    cache: shortId(stack, 'sg', 4),
  };
  return { vpcId, subnets, groups };
};

const networkResources = (stack: DemoStack, net: ReturnType<typeof network>): DemoResource[] => [
  {
    type: 'vpc',
    service: 'network',
    nativeId: net.vpcId,
    name: `acme-${stack.stage}`,
    status: 'available',
    health: 'healthy',
    tags: tagsOf(stack, { Name: `acme-${stack.stage}` }),
    details: { cidrBlock: `${stack.cidrPrefix}.0.0/16`, isDefault: false },
  },
  ...net.subnets.map(({ id, zone, isPublic, index }) => ({
    type: 'subnet' as const,
    service: 'network',
    nativeId: id,
    name: `acme-${stack.stage}-${isPublic ? 'public' : 'private'}-${zone.slice(-1)}`,
    status: 'available',
    health: 'healthy' as const,
    tags: tagsOf(stack),
    details: {
      vpcId: net.vpcId,
      cidrBlock: `${stack.cidrPrefix}.${index * 16}.0/20`,
      availabilityZone: zone,
      availableIps: 4000 - index * 37,
      publicIpOnLaunch: isPublic,
      public: isPublic,
    },
  })),
  securityGroup(stack, net, net.groups.balancer, 'load-balancer', true, []),
  securityGroup(stack, net, net.groups.app, 'app', false, [net.groups.balancer]),
  securityGroup(stack, net, net.groups.database, 'database', false, [net.groups.app]),
  securityGroup(stack, net, net.groups.cache, 'cache', false, [net.groups.app]),
];

const securityGroup = (
  stack: DemoStack,
  net: ReturnType<typeof network>,
  id: string,
  role: string,
  openToInternet: boolean,
  allowedFrom: string[],
): DemoResource => ({
  type: 'security-group',
  service: 'network',
  nativeId: id,
  name: `acme-${stack.stage}-${role}`,
  status: 'exists',
  health: 'healthy',
  tags: tagsOf(stack),
  details: {
    description: `Acme ${stack.stage} ${role}`,
    vpcId: net.vpcId,
    inboundRules: openToInternet ? 2 : 1,
    outboundRules: 1,
    openToInternet,
    allowedFrom,
  },
});

const appResources = (stack: DemoStack, net: ReturnType<typeof network>): DemoResource[] => {
  const cluster = `acme-${stack.stage}`;
  const privateSubnets = net.subnets.filter(({ isPublic }) => !isPublic).map(({ id }) => id);
  const targetGroups = ['api', 'web'].map((app) =>
    arn(stack, 'elasticloadbalancing', `targetgroup/acme-${stack.stage}-${app}/5f2c8e1a9b3d7c64`),
  );
  const balancerArn = arn(stack, 'elasticloadbalancing', `loadbalancer/app/acme-${stack.stage}/9d4e2a7b1c8f3e05`);
  const services = ['api', 'web', 'worker'].map((app, index) =>
    ecsService(stack, cluster, app, privateSubnets, net.groups.app, targetGroups[index]),
  );
  return [
    {
      type: 'load-balancer',
      service: 'network',
      nativeId: balancerArn,
      name: `acme-${stack.stage}`,
      status: 'active',
      health: 'healthy',
      tags: tagsOf(stack),
      details: {
        type: 'application',
        scheme: 'internet-facing',
        dnsName: `acme-${stack.stage}-1234567890.${stack.region}.elb.amazonaws.com`,
        vpcId: net.vpcId,
        subnetIds: net.subnets.filter(({ isPublic }) => isPublic).map(({ id }) => id),
        securityGroups: [net.groups.balancer],
        targetGroups,
        targetInstances: [],
      },
    },
    {
      type: 'ecs-cluster',
      service: 'ecs',
      nativeId: arn(stack, 'ecs', `cluster/${cluster}`),
      name: cluster,
      status: 'ACTIVE',
      health: 'healthy',
      tags: tagsOf(stack),
      details: { runningTasks: stack.appTasks * 3, pendingTasks: 0, activeServices: 3, containerInstances: 0 },
    },
    ...services,
  ];
};

const ecsService = (
  stack: DemoStack,
  cluster: string,
  app: string,
  subnetIds: string[],
  securityGroup: string,
  targetGroup: string | undefined,
): DemoResource => {
  const deploying = stack.deploying === app;
  const running = deploying ? stack.appTasks - 1 : stack.appTasks;
  return {
    type: 'ecs-service',
    service: 'ecs',
    nativeId: arn(stack, 'ecs', `service/${cluster}/acme-${app}`),
    name: `acme-${app}`,
    status: deploying ? 'DEPLOYING' : 'ACTIVE',
    health: deploying ? 'degraded' : 'healthy',
    tags: tagsOf(stack, { App: app }),
    details: {
      cluster,
      launchType: 'FARGATE',
      desiredTasks: stack.appTasks,
      runningTasks: running,
      pendingTasks: stack.appTasks - running,
      taskDefinition: `acme-${app}:${deploying ? 58 : 57}`,
      platformVersion: '1.4.0',
      rolloutState: deploying ? 'IN_PROGRESS' : 'COMPLETED',
      subnetIds,
      securityGroups: [securityGroup],
      targetGroups: targetGroup ? [targetGroup] : [],
    },
  };
};

const dataResources = (stack: DemoStack, net: ReturnType<typeof network>): DemoResource[] => {
  const privateSubnets = net.subnets.filter(({ isPublic }) => !isPublic).map(({ id }) => id);
  const database = `acme-${stack.stage}`;
  return [
    {
      type: 'rds-cluster',
      service: 'rds',
      nativeId: arn(stack, 'rds', `cluster:${database}`),
      name: database,
      status: 'available',
      health: 'healthy',
      tags: tagsOf(stack),
      details: {
        engine: 'aurora-postgresql',
        engineVersion: '16.4',
        members: 2,
        multiAz: true,
        storageEncrypted: true,
        securityGroups: [net.groups.database],
      },
    },
    ...[1, 2].map((member) => ({
      type: 'rds-instance' as const,
      service: 'rds',
      nativeId: arn(stack, 'rds', `db:${database}-${member}`),
      name: `${database}-${member}`,
      status: 'available',
      health: 'healthy' as const,
      tags: tagsOf(stack),
      details: {
        engine: 'aurora-postgresql',
        engineVersion: '16.4',
        instanceClass: 'db.t4g.medium',
        multiAz: false,
        cluster: database,
        publiclyAccessible: false,
        storageEncrypted: true,
        vpcId: net.vpcId,
        subnetIds: privateSubnets,
        securityGroups: [net.groups.database],
      },
    })),
    {
      type: 'elasticache-replication-group',
      service: 'elasticache',
      nativeId: arn(stack, 'elasticache', `replicationgroup:acme-${stack.stage}`),
      name: `acme-${stack.stage}`,
      status: 'available',
      health: 'healthy',
      tags: tagsOf(stack),
      details: {
        description: `Acme ${stack.stage} cache`,
        nodeType: 'cache.t4g.small',
        members: 1,
        automaticFailover: 'disabled',
        multiAz: 'disabled',
        encryptedInTransit: true,
        encryptedAtRest: true,
        vpcId: net.vpcId,
        subnetIds: privateSubnets,
        securityGroups: [net.groups.cache],
      },
    },
    {
      type: 'elasticache-cluster',
      service: 'elasticache',
      nativeId: arn(stack, 'elasticache', `cluster:acme-${stack.stage}-001`),
      name: `acme-${stack.stage}-001`,
      status: 'available',
      health: 'healthy',
      tags: tagsOf(stack),
      details: {
        engine: 'valkey',
        engineVersion: '8.0',
        nodeType: 'cache.t4g.small',
        nodes: 1,
        replicationGroup: `acme-${stack.stage}`,
        vpcId: net.vpcId,
        subnetIds: privateSubnets,
        securityGroups: [net.groups.cache],
      },
    },
  ];
};

const storageResources = (stack: DemoStack): DemoResource[] => [
  ...['uploads', 'backups'].map((purpose) => ({
    type: 's3-bucket' as const,
    service: 's3',
    nativeId: `arn:aws:s3:::acme-${stack.stage}-${purpose}`,
    name: `acme-${stack.stage}-${purpose}`,
    status: 'exists',
    health: 'healthy' as const,
    tags: tagsOf(stack),
    details: { createdAt: '2026-03-02T09:00:00.000Z' },
  })),
  ...['database', 'app'].map((purpose) => ({
    type: 'secrets-manager-secret' as const,
    service: 'secrets',
    nativeId: arn(stack, 'secretsmanager', `secret:acme/${stack.stage}/${purpose}-Xy12Ab`),
    name: `acme/${stack.stage}/${purpose}`,
    status: 'active',
    health: 'healthy' as const,
    tags: tagsOf(stack),
    details: {
      description: `Acme ${stack.stage} ${purpose} settings`,
      lastChangedAt: '2026-10-21T14:30:00.000Z',
      rotationEnabled: purpose === 'database',
    },
  })),
];

export const demoResources = (stack: DemoStack): DemoResource[] => {
  const net = network(stack);
  return [
    ...networkResources(stack, net),
    ...appResources(stack, net),
    ...dataResources(stack, net),
    ...storageResources(stack),
  ];
};
