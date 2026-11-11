import { DescribeServicesCommand, ECSClient } from '@aws-sdk/client-ecs';
import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import type { ExperimentTarget, ExperimentTemplate } from '@pulsegrid/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import type { InventoryItem } from '../provider';
import { fisFootprint } from './aws-fis-footprint';
import { fisNotReady } from './aws-fis-readiness';

const inventory: InventoryItem[] = [
  { id: 'r1', type: 'rds-instance', nativeId: 'arn:aws:rds:eu-central-1:1:db:staging-db', name: 'staging-db', region: 'eu-central-1', tags: { Env: 'staging' }, details: {} },
  { id: 'r2', type: 'rds-instance', nativeId: 'arn:aws:rds:eu-central-1:1:db:reports-db', name: 'reports-db', region: 'eu-central-1', tags: { Env: 'staging' }, details: {} },
  { id: 's1', type: 'ecs-service', nativeId: 'arn:aws:ecs:eu-central-1:1:service/main/api', name: 'api', region: 'eu-central-1', tags: {}, details: { cluster: 'main' } },
];
const target = (overrides: Partial<ExperimentTarget>): ExperimentTarget => ({
  name: 'Targets',
  resourceType: 'aws:rds:db',
  selection: '',
  resourceIds: [],
  ...overrides,
});
const template = (targets: ExperimentTarget[], actionIds: string[] = ['aws:rds:reboot-db-instances']): ExperimentTemplate => ({
  id: 'T',
  region: 'eu-central-1',
  label: 'T',
  description: null,
  targets,
  steps: actionIds.map((actionId) => ({ name: actionId, actionId, description: null, duration: null })),
  stopAlarms: [],
});

describe('fisFootprint', () => {
  it('matches listed ARNs to the resources PulseGrid knows', () => {
    const { resources, zoneWide } = fisFootprint(
      template([target({ resourceIds: ['arn:aws:rds:eu-central-1:1:db:staging-db'] })]),
      inventory,
    );
    expect(resources).toEqual([{ key: 'rds-instance|r1', name: 'staging-db' }]);
    expect(zoneWide).toBe(false);
  });

  it('matches tags, and ECS tasks by their cluster and service', () => {
    expect(fisFootprint(template([target({ tags: { Env: 'staging' } })]), inventory).resources.map(({ key }) => key)).toEqual([
      'rds-instance|r1',
      'rds-instance|r2',
    ]);
    const tasks = target({ resourceType: 'aws:ecs:task', parameters: { cluster: 'main', service: 'api' } });
    expect(fisFootprint(template([tasks], ['aws:ecs:stop-task']), inventory).resources).toEqual([
      { key: 'ecs-service|s1', name: 'api' },
    ]);
  });

  it('falls back to any resource of the type when it cannot tell which', () => {
    expect(fisFootprint(template([target({ tags: { Env: 'nowhere' } })]), inventory).resources).toEqual([
      { key: 'rds-instance|*', name: 'any rds db' },
    ]);
  });

  it('spots tests that act on a whole zone', () => {
    expect(fisFootprint(template([target({ resourceType: 'aws:ec2:subnet' })], ['aws:network:disrupt-connectivity']), inventory))
      .toMatchObject({ resources: [], zoneWide: true });
    expect(fisFootprint(template([target({})], ['aws:network:disrupt-connectivity']), inventory).zoneWide).toBe(true);
  });
});

describe('test flags', () => {
  it('spots tests that stop servers, and ECS tests that need a spare task', () => {
    const servers = template([target({ resourceType: 'aws:ec2:instance' })], ['aws:ec2:stop-instances']);
    expect(fisFootprint(servers, inventory)).toMatchObject({ stopsInstances: true, needsSpareTask: false });
    const oneTask = target({ resourceType: 'aws:ecs:task', selectionMode: 'COUNT(1)', parameters: { cluster: 'main', service: 'api' } });
    expect(fisFootprint(template([oneTask], ['aws:ecs:stop-task']), inventory).needsSpareTask).toBe(true);
    const allTasks = { ...oneTask, selectionMode: 'ALL' };
    expect(fisFootprint(template([allTasks], ['aws:ecs:stop-task']), inventory).needsSpareTask).toBe(false);
  });
});

describe('fisNotReady', () => {
  const rds = mockClient(RDSClient);
  const ecs = mockClient(ECSClient);
  const context = { credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, region: 'eu-central-1' };
  const footprint = { resources: [], zoneWide: false, stopsInstances: false, needsSpareTask: false };
  beforeEach(() => {
    rds.reset();
    ecs.reset();
  });

  it('says a database is not ready until it is available', async () => {
    rds.on(DescribeDBInstancesCommand).resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'rebooting' }] });
    expect(await fisNotReady(context, inventory[0]!, footprint)).toBe("staging-db isn't available (rebooting)");
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [{ DBInstanceStatus: 'available' }] });
    expect(await fisNotReady(context, inventory[0]!, footprint)).toBeNull();
  });

  it('needs two running tasks before stopping one', async () => {
    ecs.on(DescribeServicesCommand).resolves({ services: [{ runningCount: 1, desiredCount: 1, deployments: [{}] }] });
    expect(await fisNotReady(context, inventory[2]!, { ...footprint, needsSpareTask: true })).toBe('api has 1 running task, needs 2');
    expect(await fisNotReady(context, inventory[2]!, footprint)).toBeNull();
  });

  it("doesn't skip when AWS can't be asked, or for resources without a check", async () => {
    rds.on(DescribeDBInstancesCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    expect(await fisNotReady(context, inventory[0]!, footprint)).toBeNull();
    expect(await fisNotReady(context, { ...inventory[0]!, type: 's3-bucket' }, footprint)).toBeNull();
  });
});
