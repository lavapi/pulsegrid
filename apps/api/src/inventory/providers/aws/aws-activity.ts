import { ECSClient, paginateListClusters, type Service } from '@aws-sdk/client-ecs';
import { EC2Client, paginateDescribeInstances } from '@aws-sdk/client-ec2';
import { ElastiCacheClient, paginateDescribeCacheClusters } from '@aws-sdk/client-elasticache';
import { paginateDescribeDBInstances, RDSClient } from '@aws-sdk/client-rds';
import type { ActivityWatch, DetectedActivity } from '../provider';
import type { AwsKey } from './aws-key';
import { collectPages } from './collectors/helpers';
import { describeServices } from './collectors/ecs.collector';

const QUIET_DATABASE_STATES = new Set(['available', 'stopped', 'backing-up', 'storage-optimization', 'maintenance']);
const QUIET_CACHE_STATES = new Set(['available', 'snapshotting']);
const SERVER_STATES: Record<string, string> = { pending: 'Starting', stopping: 'Stopping' };

const DEPLOYMENT = 'Deployment';
const DATABASE_UPDATE = 'Database update';
const CACHE_UPDATE = 'Cache update';
const SERVER_CHANGE = 'Server state change';

const sentenceCase = (status: string): string => {
  const words = status.replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

export const deploymentActivity = (service: Service): DetectedActivity | null => {
  const deployments = service.deployments ?? [];
  const primary = deployments.find(({ status }) => status === 'PRIMARY');
  if (!primary || !service.serviceArn) {
    return null;
  }
  const nativeId = service.serviceArn;
  const summary = `${primary.runningCount ?? 0} of ${primary.desiredCount ?? 0} new tasks running`;
  if (primary.rolloutState === 'FAILED') {
    return {
      resourceType: 'ecs-service',
      nativeId,
      title: DEPLOYMENT,
      summary: 'The deployment failed. Check the service in AWS for the reason.',
      failed: true,
    };
  }
  const active = primary.rolloutState ? primary.rolloutState === 'IN_PROGRESS' : deployments.length > 1;
  return active ? { resourceType: 'ecs-service', nativeId, title: DEPLOYMENT, summary, failed: false } : null;
};

export const AWS_ACTIVITY_WATCHES: readonly ActivityWatch<AwsKey>[] = [
  {
    types: ['ecs-service'],
    detect: async ({ credentials, region }) => {
      const client = new ECSClient({ region, credentials });
      const clusters = await collectPages(paginateListClusters({ client }, {}), (page) => page.clusterArns);
      const services = await Promise.all(clusters.map((cluster) => describeServices(client, cluster)));
      return services.flat().flatMap((service) => deploymentActivity(service) ?? []);
    },
  },
  {
    types: ['rds-instance'],
    detect: async ({ credentials, region }) => {
      const client = new RDSClient({ region, credentials });
      const instances = await collectPages(paginateDescribeDBInstances({ client }, {}), (page) => page.DBInstances);
      return instances.flatMap(({ DBInstanceArn: nativeId, DBInstanceStatus: status }) =>
        nativeId && status && !QUIET_DATABASE_STATES.has(status)
          ? [
              {
                resourceType: 'rds-instance' as const,
                nativeId,
                title: DATABASE_UPDATE,
                summary: sentenceCase(status),
                failed: status === 'failed',
              },
            ]
          : [],
      );
    },
  },
  {
    types: ['elasticache-cluster'],
    detect: async ({ credentials, region }) => {
      const client = new ElastiCacheClient({ region, credentials });
      const clusters = await collectPages(paginateDescribeCacheClusters({ client }, {}), (page) => page.CacheClusters);
      return clusters.flatMap(({ ARN: nativeId, CacheClusterStatus: status }) =>
        nativeId && status && !QUIET_CACHE_STATES.has(status)
          ? [
              {
                resourceType: 'elasticache-cluster' as const,
                nativeId,
                title: CACHE_UPDATE,
                summary: sentenceCase(status),
                failed: false,
              },
            ]
          : [],
      );
    },
  },
  {
    types: ['ec2-instance'],
    detect: async ({ credentials, region }) => {
      const client = new EC2Client({ region, credentials });
      const reservations = await collectPages(
        paginateDescribeInstances(
          { client },
          { Filters: [{ Name: 'instance-state-name', Values: Object.keys(SERVER_STATES) }] },
        ),
        (page) => page.Reservations,
      );
      return reservations
        .flatMap(({ Instances: instances }) => instances ?? [])
        .flatMap(({ InstanceId: nativeId, State: state }) =>
          nativeId
            ? [
                {
                  resourceType: 'ec2-instance' as const,
                  nativeId,
                  title: SERVER_CHANGE,
                  summary: SERVER_STATES[state?.Name ?? ''] ?? sentenceCase(state?.Name ?? 'changing'),
                  failed: false,
                },
              ]
            : [],
        );
    },
  },
];
