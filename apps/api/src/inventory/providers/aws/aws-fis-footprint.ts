import type { ExperimentTarget, ExperimentTemplate, ResourceType, TouchedResource } from '@pulsegrid/shared';
import { ANY, resourceKey } from '../../experiments/resource-keys';
import type { InventoryItem, TestFootprint } from '../provider';

/** FIS target types and the PulseGrid resource each one acts on. ECS tasks act on their service. */
const TARGET_TYPES: Record<string, ResourceType> = {
  'aws:rds:db': 'rds-instance',
  'aws:rds:cluster': 'rds-cluster',
  'aws:elasticache:redis-replicationgroup': 'elasticache-replication-group',
  'aws:elasticache:replicationgroup': 'elasticache-replication-group',
  'aws:ec2:instance': 'ec2-instance',
  'aws:ecs:task': 'ecs-service',
};

/** Tests that cut a whole Availability Zone off, rather than one resource in it. */
const ZONE_TARGET_TYPES = ['aws:ec2:subnet', 'aws:ec2:transit-gateway'];
const ZONE_ACTIONS = ['aws:network:disrupt-connectivity', 'aws:network:route-table-disrupt-cross-region-connectivity'];

const anyOf = (targetType: string): TouchedResource => ({
  key: resourceKey(TARGET_TYPES[targetType] ?? targetType, ANY),
  name: `any ${targetType.replace(/^aws:/, '').replaceAll(':', ' ')}`,
});

const toTouched = ({ id, type, name }: InventoryItem): TouchedResource => ({ key: resourceKey(type, id), name });

/** An ARN names a resource by its ID or name after the last : or /. */
const arnMatches = (arn: string, { nativeId, name }: InventoryItem): boolean => {
  const tail = arn.split(/[:/]/).at(-1);
  return arn === nativeId || tail === nativeId || tail === name;
};

const hasTags = (tags: Record<string, string>, item: InventoryItem): boolean =>
  Object.entries(tags).every(([key, value]) => item.tags[key] === value);

const matchTarget = (target: ExperimentTarget, inventory: readonly InventoryItem[]): TouchedResource[] => {
  const type = TARGET_TYPES[target.resourceType];
  if (!type) {
    return [anyOf(target.resourceType)];
  }
  const candidates = inventory.filter((item) => item.type === type);
  const { cluster, service } = target.parameters ?? {};
  const tags = target.tags ?? {};
  let matched: InventoryItem[] = [];
  if (target.resourceIds.length > 0) {
    matched = candidates.filter((item) => target.resourceIds.some((arn) => arnMatches(arn, item)));
  } else if (service) {
    matched = candidates.filter((item) => item.name === service && (!cluster || item.details['cluster'] === cluster));
  } else if (Object.keys(tags).length > 0) {
    matched = candidates.filter((item) => hasTags(tags, item));
  }
  return matched.length > 0 ? matched.map(toTouched) : [anyOf(target.resourceType)];
};

const unique = (resources: readonly TouchedResource[]): TouchedResource[] => [
  ...new Map(resources.map((resource) => [resource.key, resource])).values(),
];

/**
 * What a template acts on: resources PulseGrid knows when the target names or tags them, or any resource of the
 * type when it can't tell, which keeps tests that might clash apart.
 */
export const fisFootprint = (template: ExperimentTemplate, inventory: readonly InventoryItem[]): TestFootprint => {
  const zoneWide =
    template.targets.some(({ resourceType }) => ZONE_TARGET_TYPES.includes(resourceType)) ||
    template.steps.some(({ actionId }) => ZONE_ACTIONS.includes(actionId));
  return {
    resources: unique(
      template.targets
        .filter(({ resourceType }) => !ZONE_TARGET_TYPES.includes(resourceType))
        .flatMap((target) => matchTarget(target, inventory)),
    ),
    zoneWide,
  };
};
