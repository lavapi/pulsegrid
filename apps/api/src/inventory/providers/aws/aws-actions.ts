import { DescribeServicesCommand, ECSClient, UpdateServiceCommand } from '@aws-sdk/client-ecs';
import { DescribeInstanceStatusCommand, EC2Client, RebootInstancesCommand } from '@aws-sdk/client-ec2';
import {
  DescribeCacheClustersCommand,
  ElastiCacheClient,
  RebootCacheClusterCommand,
} from '@aws-sdk/client-elasticache';
import { DescribeDBInstancesCommand, RDSClient, RebootDBInstanceCommand } from '@aws-sdk/client-rds';
import type { ActionProgress, ResourceAction, ResourceActionContext } from '../provider';
import { isAccessDenied } from './aws-error-messages';
import type { AwsKey } from './aws-key';

const FAILED_STATES = new Set(['failed', 'incompatible-network', 'incompatible-parameters']);
const RESTART_GRACE_MS = 30_000;
const SERVER_GRACE_MS = 60_000;
const SERVER_UNCONFIRMED = "Reboot sent, but this key can't confirm it finished.";
const SERVER_PROBLEM = 'AWS reports a problem with this server. Check it in AWS.';

const elapsedMs = (startedAt: Date): number => Date.now() - startedAt.getTime();

const running = (summary: string): ActionProgress => ({ state: 'running', summary });

const clusterOf = ({ resource }: ResourceActionContext<AwsKey>): string =>
  String(resource.details['cluster']);

export const restartProgress = (status: string | undefined, startedAt: Date): ActionProgress => {
  if (status && FAILED_STATES.has(status)) {
    return { state: 'failed', summary: `AWS reports this as ${status}. Check it in AWS.` };
  }
  if (status === 'available' && elapsedMs(startedAt) >= RESTART_GRACE_MS) {
    return { state: 'succeeded', summary: 'Available' };
  }
  return running('Rebooting');
};

const cacheNodes = async (client: ElastiCacheClient, name: string): Promise<string[]> => {
  const { CacheClusters: clusters } = await client.send(
    new DescribeCacheClustersCommand({ CacheClusterId: name, ShowCacheNodeInfo: true }),
  );
  return (clusters?.[0]?.CacheNodes ?? []).flatMap(({ CacheNodeId: id }) => id ?? []);
};

export const AWS_ACTIONS: readonly ResourceAction<AwsKey>[] = [
  {
    permission: 'service.redeploy',
    resourceType: 'ecs-service',
    timeoutMinutes: 30,
    run: async (context) => {
      const { credentials, region, resource } = context;
      const { service } = await new ECSClient({ region, credentials }).send(
        new UpdateServiceCommand({
          cluster: clusterOf(context),
          service: resource.nativeId,
          forceNewDeployment: true,
        }),
      );
      const primary = service?.deployments?.find(({ status }) => status === 'PRIMARY');
      return { trackingId: primary?.id ?? null, summary: 'Starting new tasks' };
    },
    track: async (context) => {
      const { credentials, region, resource, trackingId } = context;
      const { services } = await new ECSClient({ region, credentials }).send(
        new DescribeServicesCommand({ cluster: clusterOf(context), services: [resource.nativeId] }),
      );
      const deployments = services?.[0]?.deployments ?? [];
      const deployment = deployments.find(({ id, status }) =>
        trackingId ? id === trackingId : status === 'PRIMARY',
      );
      if (!deployment) {
        return { state: 'failed', summary: 'A newer deployment replaced this one.' };
      }
      const desired = deployment.desiredCount ?? 0;
      const tasks = deployment.runningCount ?? 0;
      const summary = `${tasks} of ${desired} new tasks running`;
      if (deployment.rolloutState === 'FAILED') {
        return { state: 'failed', summary: 'The deployment failed. Check the service in AWS for the reason.' };
      }
      const settled = !deployment.rolloutState && deployments.length === 1 && tasks >= desired;
      return deployment.rolloutState === 'COMPLETED' || settled
        ? { state: 'succeeded', summary }
        : running(summary);
    },
  },
  {
    permission: 'database.reboot',
    resourceType: 'rds-instance',
    timeoutMinutes: 15,
    run: async ({ credentials, region, resource }) => {
      await new RDSClient({ region, credentials }).send(
        new RebootDBInstanceCommand({ DBInstanceIdentifier: resource.name }),
      );
      return { trackingId: null, summary: 'Rebooting' };
    },
    track: async ({ credentials, region, resource, startedAt }) => {
      const { DBInstances: instances } = await new RDSClient({ region, credentials }).send(
        new DescribeDBInstancesCommand({ DBInstanceIdentifier: resource.name }),
      );
      return restartProgress(instances?.[0]?.DBInstanceStatus, startedAt);
    },
  },
  {
    permission: 'cache.reboot',
    resourceType: 'elasticache-cluster',
    timeoutMinutes: 15,
    run: async ({ credentials, region, resource }) => {
      const client = new ElastiCacheClient({ region, credentials });
      await client.send(
        new RebootCacheClusterCommand({
          CacheClusterId: resource.name,
          CacheNodeIdsToReboot: await cacheNodes(client, resource.name),
        }),
      );
      return { trackingId: null, summary: 'Rebooting' };
    },
    track: async ({ credentials, region, resource, startedAt }) => {
      const { CacheClusters: clusters } = await new ElastiCacheClient({ region, credentials }).send(
        new DescribeCacheClustersCommand({ CacheClusterId: resource.name }),
      );
      return restartProgress(clusters?.[0]?.CacheClusterStatus, startedAt);
    },
  },
  {
    permission: 'server.reboot',
    resourceType: 'ec2-instance',
    timeoutMinutes: 10,
    run: async ({ credentials, region, resource }) => {
      await new EC2Client({ region, credentials }).send(
        new RebootInstancesCommand({ InstanceIds: [resource.nativeId] }),
      );
      return { trackingId: null, summary: 'Restarting' };
    },
    track: async ({ credentials, region, resource, startedAt }) => {
      try {
        const { InstanceStatuses: statuses } = await new EC2Client({ region, credentials }).send(
          new DescribeInstanceStatusCommand({
            InstanceIds: [resource.nativeId],
            IncludeAllInstances: true,
          }),
        );
        const status = statuses?.[0];
        if (status?.InstanceState?.Name !== 'running' || elapsedMs(startedAt) < SERVER_GRACE_MS) {
          return running('Restarting');
        }
        const checks = [status.InstanceStatus?.Status, status.SystemStatus?.Status];
        if (checks.includes('impaired')) {
          return { state: 'failed', summary: SERVER_PROBLEM };
        }
        return checks.every((check) => check === 'ok')
          ? { state: 'succeeded', summary: 'Ready. AWS status checks passed.' }
          : running('Checking');
      } catch (error) {
        if (isAccessDenied(error)) {
          return { state: 'unconfirmed', summary: SERVER_UNCONFIRMED };
        }
        throw error;
      }
    },
  },
];
