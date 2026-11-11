import { DescribeDBInstancesCommand, RDSClient } from '@aws-sdk/client-rds';
import type { ExperimentTarget, ExperimentTemplate } from '@pulsegrid/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import type { InventoryItem } from '../provider';
import { fisFootprint } from './aws-fis-footprint';
import { fisIsRecovered } from './aws-fis-recovery';

const inventory: InventoryItem[] = [
  { id: 'r1', type: 'rds-instance', nativeId: 'arn:aws:rds:eu-central-1:1:db:staging-db', name: 'staging-db', tags: { Env: 'staging' }, details: {} },
  { id: 'r2', type: 'rds-instance', nativeId: 'arn:aws:rds:eu-central-1:1:db:reports-db', name: 'reports-db', tags: { Env: 'staging' }, details: {} },
  { id: 's1', type: 'ecs-service', nativeId: 'arn:aws:ecs:eu-central-1:1:service/main/api', name: 'api', tags: {}, details: { cluster: 'main' } },
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
      .toEqual({ resources: [], zoneWide: true });
    expect(fisFootprint(template([target({})], ['aws:network:disrupt-connectivity']), inventory).zoneWide).toBe(true);
  });
});

describe('fisIsRecovered', () => {
  const rds = mockClient(RDSClient);
  const context = { credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, region: 'eu-central-1' };
  beforeEach(() => rds.reset());

  it('says a database has recovered once it is available again', async () => {
    rds.on(DescribeDBInstancesCommand).resolvesOnce({ DBInstances: [{ DBInstanceStatus: 'rebooting' }] });
    expect(await fisIsRecovered(context, inventory[0]!)).toBe(false);
    rds.on(DescribeDBInstancesCommand).resolves({ DBInstances: [{ DBInstanceStatus: 'available' }] });
    expect(await fisIsRecovered(context, inventory[0]!)).toBe(true);
  });

  it("doesn't know when AWS can't be asked, or for resources without a check", async () => {
    rds.on(DescribeDBInstancesCommand).rejects(Object.assign(new Error('no'), { name: 'AccessDenied' }));
    expect(await fisIsRecovered(context, inventory[0]!)).toBeNull();
    expect(await fisIsRecovered(context, { ...inventory[0]!, type: 's3-bucket' })).toBeNull();
  });
});
