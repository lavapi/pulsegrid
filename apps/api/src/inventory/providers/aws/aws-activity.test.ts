import { EC2Client } from '@aws-sdk/client-ec2';
import { ElastiCacheClient } from '@aws-sdk/client-elasticache';
import { RDSClient } from '@aws-sdk/client-rds';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AWS_ACTIVITY_WATCHES, deploymentActivity } from './aws-activity';

const context = {
  credentials: { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'x'.repeat(40) },
  region: 'eu-central-1',
};
const watchFor = (type: string) => {
  const watch = AWS_ACTIVITY_WATCHES.find(({ types }) => (types as readonly string[]).includes(type));
  if (!watch) {
    throw new Error(`No watch for ${type}.`);
  }
  return watch;
};

describe('deploymentActivity', () => {
  const service = (deployments: object[]) => ({ serviceArn: 'arn:service', deployments });

  it('reports a rollout in progress', () => {
    expect(
      deploymentActivity(
        service([{ status: 'PRIMARY', rolloutState: 'IN_PROGRESS', runningCount: 1, desiredCount: 2 }]),
      ),
    ).toEqual({
      resourceType: 'ecs-service',
      nativeId: 'arn:service',
      title: 'Deployment',
      summary: '1 of 2 new tasks running',
      failed: false,
    });
  });

  it('ignores a finished rollout', () => {
    expect(deploymentActivity(service([{ status: 'PRIMARY', rolloutState: 'COMPLETED' }]))).toBeNull();
  });

  it('marks a failed rollout, without AWS text', () => {
    const result = deploymentActivity(
      service([{ status: 'PRIMARY', rolloutState: 'FAILED', rolloutStateReason: 'raw aws text' }]),
    );
    expect(result?.failed).toBe(true);
    expect(result?.summary).not.toContain('raw aws text');
  });

  it('uses the deployment count for services with no rollout state', () => {
    expect(deploymentActivity(service([{ status: 'PRIMARY' }, { status: 'ACTIVE' }]))).not.toBeNull();
    expect(deploymentActivity(service([{ status: 'PRIMARY' }]))).toBeNull();
  });

  it('ignores services without a primary deployment', () => {
    expect(deploymentActivity(service([]))).toBeNull();
  });
});

describe('AWS activity watches', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports database work, but not routine states', async () => {
    vi.spyOn(RDSClient.prototype, 'send').mockResolvedValue({
      DBInstances: [
        { DBInstanceArn: 'a', DBInstanceStatus: 'rebooting' },
        { DBInstanceArn: 'b', DBInstanceStatus: 'available' },
        { DBInstanceArn: 'c', DBInstanceStatus: 'backing-up' },
        { DBInstanceArn: 'd', DBInstanceStatus: 'stopped' },
        { DBInstanceArn: 'e', DBInstanceStatus: 'configuring-enhanced-monitoring' },
      ],
    } as never);
    const found = await watchFor('rds-instance').detect(context);
    expect(found.map(({ nativeId, summary }) => [nativeId, summary])).toEqual([
      ['a', 'Rebooting'],
      ['e', 'Configuring enhanced monitoring'],
    ]);
  });

  it('marks a failed database', async () => {
    vi.spyOn(RDSClient.prototype, 'send').mockResolvedValue({
      DBInstances: [{ DBInstanceArn: 'a', DBInstanceStatus: 'failed' }],
    } as never);
    expect((await watchFor('rds-instance').detect(context))[0]?.failed).toBe(true);
  });

  it('reports cache work, but not snapshots', async () => {
    vi.spyOn(ElastiCacheClient.prototype, 'send').mockResolvedValue({
      CacheClusters: [
        { ARN: 'a', CacheClusterStatus: 'rebooting cache cluster nodes' },
        { ARN: 'b', CacheClusterStatus: 'available' },
        { ARN: 'c', CacheClusterStatus: 'snapshotting' },
      ],
    } as never);
    const found = await watchFor('elasticache-cluster').detect(context);
    expect(found.map(({ nativeId, summary }) => [nativeId, summary])).toEqual([
      ['a', 'Rebooting cache cluster nodes'],
    ]);
  });

  it('reports servers starting and stopping', async () => {
    vi.spyOn(EC2Client.prototype, 'send').mockResolvedValue({
      Reservations: [
        {
          Instances: [
            { InstanceId: 'i-1', State: { Name: 'stopping' } },
            { InstanceId: 'i-2', State: { Name: 'pending' } },
          ],
        },
      ],
    } as never);
    const found = await watchFor('ec2-instance').detect(context);
    expect(found.map(({ summary }) => summary)).toEqual(['Stopping', 'Starting']);
  });
});
