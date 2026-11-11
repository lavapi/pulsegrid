import {
  type Cluster,
  DescribeClustersCommand,
  DescribeServicesCommand,
  ECSClient,
  paginateListClusters,
  paginateListServices,
  type Service,
} from '@aws-sdk/client-ecs';
import type { ResourceHealth } from '@pulsegrid/shared';
import type { CollectedResource, ResourceCollector } from '../../provider';
import type { AwsKey } from '../aws-key';
import { chunk } from '../../../../common/chunk';
import { collectPages, healthFrom, tagMap } from './helpers';

const CLUSTERS_PER_CALL = 100;
const SERVICES_PER_CALL = 10;

const describeClusters = async (client: ECSClient, arns: string[]): Promise<Cluster[]> => {
  const batches = await Promise.all(
    chunk(arns, CLUSTERS_PER_CALL).map((clusters) =>
      client.send(new DescribeClustersCommand({ clusters, include: ['TAGS'] })),
    ),
  );
  return batches.flatMap((batch) => batch.clusters ?? []);
};

export const describeServices = async (client: ECSClient, clusterArn: string): Promise<Service[]> => {
  const arns = await collectPages(
    paginateListServices({ client }, { cluster: clusterArn }),
    (page) => page.serviceArns,
  );
  const batches = await Promise.all(
    chunk(arns, SERVICES_PER_CALL).map((services) =>
      client.send(
        new DescribeServicesCommand({ cluster: clusterArn, services, include: ['TAGS'] }),
      ),
    ),
  );
  return batches.flatMap((batch) => batch.services ?? []);
};

export const serviceHealth = (service: Service): ResourceHealth => {
  const desired = service.desiredCount ?? 0;
  const running = service.runningCount ?? 0;
  if (service.status !== 'ACTIVE') {
    return 'degraded';
  }
  if (desired === 0) {
    return 'stopped';
  }
  return running >= desired ? 'healthy' : 'degraded';
};

const serviceStatus = (service: Service): string =>
  service.status === 'ACTIVE'
    ? `${service.runningCount ?? 0}/${service.desiredCount ?? 0} tasks`
    : (service.status ?? 'UNKNOWN');

const providerNames = (strategy: Service['capacityProviderStrategy']): string[] =>
  (strategy ?? []).flatMap(({ capacityProvider }) => (capacityProvider ? [capacityProvider] : []));

export const launchTypeOf = (service: Service, cluster: Cluster): string | undefined => {
  if (service.launchType) {
    return service.launchType;
  }
  const providers = providerNames(service.capacityProviderStrategy);
  const names = providers.length > 0 ? providers : providerNames(cluster.defaultCapacityProviderStrategy);
  return names.length > 0 ? names.join(', ') : undefined;
};

const shortTaskDefinition = (arn: string | undefined): string | undefined => arn?.split('/').pop();

const networkOf = (service: Service) => {
  const network = service.networkConfiguration?.awsvpcConfiguration;
  return {
    subnetIds: network?.subnets,
    securityGroups: network?.securityGroups,
    targetGroups: service.loadBalancers?.flatMap(({ targetGroupArn }) => targetGroupArn ?? []),
  };
};

const toClusterResource = (cluster: Cluster, region: string): CollectedResource => {
  const status = cluster.status ?? 'UNKNOWN';
  return {
    type: 'ecs-cluster',
    region,
    nativeId: cluster.clusterArn ?? '',
    name: cluster.clusterName ?? '',
    status,
    health: healthFrom(status, { healthy: ['active'], degraded: ['failed', 'provisioning'] }),
    tags: tagMap(cluster.tags?.map(({ key, value }) => ({ Key: key, Value: value }))),
    details: {
      runningTasks: cluster.runningTasksCount,
      pendingTasks: cluster.pendingTasksCount,
      activeServices: cluster.activeServicesCount,
      containerInstances: cluster.registeredContainerInstancesCount,
    },
  };
};

const toServiceResource = (
  service: Service,
  cluster: Cluster,
  region: string,
): CollectedResource => ({
  type: 'ecs-service',
  region,
  nativeId: service.serviceArn ?? '',
  name: service.serviceName ?? '',
  status: serviceStatus(service),
  health: serviceHealth(service),
  tags: tagMap(service.tags?.map(({ key, value }) => ({ Key: key, Value: value }))),
  details: {
    cluster: cluster.clusterName,
    launchType: launchTypeOf(service, cluster),
    desiredTasks: service.desiredCount,
    runningTasks: service.runningCount,
    pendingTasks: service.pendingCount,
    taskDefinition: shortTaskDefinition(service.taskDefinition),
    platformVersion: service.platformVersion,
    rolloutState: service.deployments?.[0]?.rolloutState,
    deploymentStrategy: service.deploymentConfiguration?.strategy ?? 'ROLLING',
    ...networkOf(service),
  },
});

export const ecsCollector: ResourceCollector<AwsKey> = {
  name: 'ecs',
  label: 'ECS',
  scope: 'regional',
  types: ['ecs-cluster', 'ecs-service'],
  collect: async ({ credentials, region }) => {
    const client = new ECSClient({ region, credentials });
    const arns = await collectPages(paginateListClusters({ client }, {}), (p) => p.clusterArns);
    const clusters = await describeClusters(client, arns);
    const services = await Promise.all(
      clusters.map(async (cluster) => {
        const items = await describeServices(client, cluster.clusterArn ?? '');
        return items.map((item) => toServiceResource(item, cluster, region));
      }),
    );
    return [...clusters.map((item) => toClusterResource(item, region)), ...services.flat()];
  },
};
