import {
  DescribeServicesCommand,
  ECSClient,
  UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {
  DescribeInstanceStatusCommand,
  EC2Client,
  RebootInstancesCommand,
} from '@aws-sdk/client-ec2';
import { ElastiCacheClient, RebootCacheClusterCommand } from '@aws-sdk/client-elasticache';
import { RDSClient, RebootDBInstanceCommand } from '@aws-sdk/client-rds';
import { AWS_CHANGE_ACTIONS, type CloudPermission } from '@pulsegrid/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AWS_ACTIONS, restartProgress } from './aws-actions';
import { actionErrorMessage } from './aws-error-messages';
import { SERVICE_PERMISSIONS } from './service-catalog';

const credentials = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'x'.repeat(40) };
const actionFor = (permission: CloudPermission) => {
  const action = AWS_ACTIONS.find((item) => item.permission === permission);
  if (!action) {
    throw new Error(`No ${permission} action.`);
  }
  return action;
};
const context = (nativeId: string, name: string) => ({
  credentials,
  region: 'eu-central-1',
  resource: { nativeId, name, details: { cluster: 'main' } },
});
const perform = (permission: CloudPermission, nativeId: string, name: string) =>
  actionFor(permission).run(context(nativeId, name));
const follow = (permission: CloudPermission, trackingId: string | null, startedAt = new Date(0)) =>
  actionFor(permission).track({ ...context('id-1', 'name-1'), trackingId, startedAt });

describe('AWS actions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forces a new deployment without changing the service', async () => {
    const send = vi
      .spyOn(ECSClient.prototype, 'send')
      .mockResolvedValue({ service: { deployments: [{ id: 'new', status: 'PRIMARY' }] } } as never);
    const started = await perform('service.redeploy', 'arn:aws:ecs:service/main/api', 'api');
    expect(started.trackingId).toBe('new');
    const command = send.mock.calls[0]?.[0] as UpdateServiceCommand;
    expect(command).toBeInstanceOf(UpdateServiceCommand);
    expect(command.input).toEqual({
      cluster: 'main',
      service: 'arn:aws:ecs:service/main/api',
      forceNewDeployment: true,
    });
  });

  it('reboots a database by its identifier', async () => {
    const send = vi.spyOn(RDSClient.prototype, 'send').mockResolvedValue({} as never);
    await perform('database.reboot', 'arn:aws:rds:db:staging', 'staging');
    const command = send.mock.calls[0]?.[0] as RebootDBInstanceCommand;
    expect(command).toBeInstanceOf(RebootDBInstanceCommand);
    expect(command.input).toEqual({ DBInstanceIdentifier: 'staging' });
  });

  it('reboots one server', async () => {
    const send = vi.spyOn(EC2Client.prototype, 'send').mockResolvedValue({} as never);
    await perform('server.reboot', 'i-123', 'web');
    const command = send.mock.calls[0]?.[0] as RebootInstancesCommand;
    expect(command).toBeInstanceOf(RebootInstancesCommand);
    expect(command.input).toEqual({ InstanceIds: ['i-123'] });
  });

  it('reboots every node of a cache', async () => {
    const send = vi.spyOn(ElastiCacheClient.prototype, 'send').mockResolvedValueOnce({
      CacheClusters: [{ CacheNodes: [{ CacheNodeId: '0001' }, { CacheNodeId: '0002' }] }],
    } as never);
    send.mockResolvedValueOnce({} as never);
    await perform('cache.reboot', 'arn:aws:cache', 'staging-cache');
    const command = send.mock.calls[1]?.[0] as RebootCacheClusterCommand;
    expect(command).toBeInstanceOf(RebootCacheClusterCommand);
    expect(command.input).toEqual({ CacheClusterId: 'staging-cache', CacheNodeIdsToReboot: ['0001', '0002'] });
  });

  it('does not warn about the actions the dashboard offers', () => {
    const checked = SERVICE_PERMISSIONS.map(({ manageAction }) => manageAction);
    expect(checked.filter((action) => (AWS_CHANGE_ACTIONS as readonly string[]).includes(action))).toEqual([]);
  });

  it('explains failures without AWS text', () => {
    const named = (name: string) => Object.assign(new Error('raw'), { name });
    expect(actionErrorMessage(named('UnauthorizedOperation'))).toContain("doesn't allow that");
    expect(actionErrorMessage(named('InvalidDBInstanceStateFault'))).toContain('current state');
    expect(actionErrorMessage(named('InvalidParameterCombinationException'))).toContain('cluster mode');
    expect(actionErrorMessage(named('Something'))).toBe("AWS couldn't complete that. Please try again.");
  });
});

describe('following a force deploy', () => {
  afterEach(() => vi.restoreAllMocks());

  const answer = (deployments: object[]) =>
    vi.spyOn(ECSClient.prototype, 'send').mockResolvedValue({ services: [{ deployments }] } as never);

  it('reports task counts for the deployment it started', async () => {
    const send = answer([
      { id: 'other', status: 'ACTIVE', runningCount: 9, desiredCount: 9, rolloutState: 'COMPLETED' },
      { id: 'mine', status: 'PRIMARY', runningCount: 1, desiredCount: 2, rolloutState: 'IN_PROGRESS' },
    ]);
    expect(await follow('service.redeploy', 'mine')).toEqual({
      state: 'running',
      summary: '1 of 2 new tasks running',
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DescribeServicesCommand);
  });

  it('finishes when AWS says the rollout completed', async () => {
    answer([{ id: 'mine', runningCount: 2, desiredCount: 2, rolloutState: 'COMPLETED' }]);
    expect((await follow('service.redeploy', 'mine')).state).toBe('succeeded');
  });

  it('fails when the rollout fails, without showing AWS text', async () => {
    answer([{ id: 'mine', rolloutState: 'FAILED', rolloutStateReason: 'raw aws text' }]);
    const result = await follow('service.redeploy', 'mine');
    expect(result.state).toBe('failed');
    expect(result.summary).not.toContain('raw aws text');
  });

  it('notices when a newer deployment replaced it', async () => {
    answer([{ id: 'newer', status: 'PRIMARY' }]);
    expect(await follow('service.redeploy', 'mine')).toEqual({
      state: 'failed',
      summary: 'A newer deployment replaced this one.',
    });
  });

  it('uses task counts for services with no rollout state', async () => {
    answer([{ id: 'mine', runningCount: 2, desiredCount: 2 }]);
    expect((await follow('service.redeploy', 'mine')).state).toBe('succeeded');
    vi.restoreAllMocks();
    answer([
      { id: 'mine', runningCount: 2, desiredCount: 2 },
      { id: 'old', runningCount: 2, desiredCount: 2 },
    ]);
    expect((await follow('service.redeploy', 'mine')).state).toBe('running');
  });
});

describe('following a reboot', () => {
  afterEach(() => vi.restoreAllMocks());

  it('waits while the resource restarts', () => {
    expect(restartProgress('rebooting', new Date(0)).state).toBe('running');
  });

  it('does not trust "available" right after the reboot', () => {
    expect(restartProgress('available', new Date()).state).toBe('running');
    expect(restartProgress('available', new Date(0))).toEqual({ state: 'succeeded', summary: 'Available' });
  });

  it('fails when AWS reports a failed state', () => {
    expect(restartProgress('failed', new Date(0)).state).toBe('failed');
  });

  it('reads the database status', async () => {
    vi.spyOn(RDSClient.prototype, 'send').mockResolvedValue({
      DBInstances: [{ DBInstanceStatus: 'rebooting' }],
    } as never);
    expect(await follow('database.reboot', null)).toEqual({ state: 'running', summary: 'Rebooting' });
  });

  it('reads the cache status', async () => {
    vi.spyOn(ElastiCacheClient.prototype, 'send').mockResolvedValue({
      CacheClusters: [{ CacheClusterStatus: 'available' }],
    } as never);
    expect((await follow('cache.reboot', null)).state).toBe('succeeded');
  });

  const serverAnswers = (instance: string, system: string, state = 'running') =>
    vi.spyOn(EC2Client.prototype, 'send').mockResolvedValue({
      InstanceStatuses: [
        {
          InstanceState: { Name: state },
          InstanceStatus: { Status: instance },
          SystemStatus: { Status: system },
        },
      ],
    } as never);

  it('waits for a server to stop and for its checks to pass', async () => {
    serverAnswers('ok', 'ok');
    expect((await follow('server.reboot', null, new Date())).summary).toBe('Restarting');
    vi.restoreAllMocks();
    const send = serverAnswers('initializing', 'ok');
    expect(await follow('server.reboot', null)).toEqual({ state: 'running', summary: 'Checking' });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DescribeInstanceStatusCommand);
  });

  it('finishes when the status checks pass', async () => {
    serverAnswers('ok', 'ok');
    expect((await follow('server.reboot', null)).state).toBe('succeeded');
  });

  it('fails when a server is impaired', async () => {
    serverAnswers('impaired', 'ok');
    expect((await follow('server.reboot', null)).state).toBe('failed');
  });

  it('says so when the key cannot read status checks', async () => {
    vi.spyOn(EC2Client.prototype, 'send').mockRejectedValue(
      Object.assign(new Error('raw'), { name: 'UnauthorizedOperation' }) as never,
    );
    expect(await follow('server.reboot', null)).toEqual({
      state: 'unconfirmed',
      summary: "Reboot sent, but this key can't confirm it finished.",
    });
  });

  it('retries other AWS errors', async () => {
    vi.spyOn(EC2Client.prototype, 'send').mockRejectedValue(new Error('throttled') as never);
    await expect(follow('server.reboot', null)).rejects.toThrow('throttled');
  });
});
