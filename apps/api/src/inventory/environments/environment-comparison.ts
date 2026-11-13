import type {
  ComparedResource,
  ComparisonDifference,
  ComparisonRow,
  ComparisonState,
  ResourceType,
} from '@pulsegrid/shared';

export const COMPARED_FIELDS: Partial<Record<ResourceType, readonly string[]>> = {
  'ecs-cluster': [],
  'ecs-service': ['launchType', 'desiredTasks'],
  'ec2-instance': ['instanceType'],
  'rds-cluster': ['engine', 'engineVersion', 'multiAz', 'storageEncrypted'],
  'rds-instance': ['engine', 'engineVersion', 'instanceClass', 'multiAz', 'storageEncrypted'],
  'elasticache-replication-group': ['nodeType', 'encryptedInTransit', 'encryptedAtRest'],
  'elasticache-cluster': ['engine', 'engineVersion', 'nodeType'],
  's3-bucket': [],
  'load-balancer': ['type', 'scheme'],
};

export const COMPARED_TYPES = Object.keys(COMPARED_FIELDS) as ResourceType[];

const ENVIRONMENT_WORDS =
  'production|prod|prd|live|staging|stage|stg|development|develop|dev|qa|testing|test|uat';

const ACCOUNT_ID_PATTERN = /(^|[-_./\s])\d{12}(?=$|[-_./\s])/g;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wordPattern = (environmentNames: readonly string[]): RegExp => {
  const names = environmentNames.map((name) => escapeRegExp(name.toLowerCase()));
  const words = [...names, ENVIRONMENT_WORDS].join('|');
  return new RegExp(`(^|[-_./\\s])(${words})(?=$|[-_./\\s])`, 'g');
};

export const comparisonKey = (name: string, environmentNames: readonly string[] = []): string => {
  const lower = name.toLowerCase();
  const key = lower
    .replace(wordPattern(environmentNames), '$1')
    .replace(ACCOUNT_ID_PATTERN, '$1')
    .replace(/[-_./\s]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return key || lower;
};

export interface ComparableResource extends ComparedResource {
  type: ResourceType;
  details: Record<string, unknown>;
}

const isGroupMember = ({ type, details }: ComparableResource): boolean =>
  type === 'elasticache-cluster' && Boolean(details['replicationGroup']);

const display = (value: unknown): string =>
  value === undefined || value === null ? 'Not set' : String(value);

const differencesBetween = (
  left: ComparableResource,
  right: ComparableResource,
): ComparisonDifference[] =>
  (COMPARED_FIELDS[left.type] ?? []).flatMap((field) => {
    const [leftValue, rightValue] = [display(left.details[field]), display(right.details[field])];
    return leftValue === rightValue ? [] : [{ field, left: leftValue, right: rightValue }];
  });

const summary = ({ id, name, displayName, status, health }: ComparableResource): ComparedResource => ({
  id,
  name,
  displayName,
  status,
  health,
});

const groupByKey = (
  resources: readonly ComparableResource[],
  environmentNames: readonly string[],
): Map<string, ComparableResource[]> => {
  const groups = new Map<string, ComparableResource[]>();
  for (const resource of [...resources].sort((a, b) => a.name.localeCompare(b.name))) {
    const key = `${resource.type}|${comparisonKey(resource.name, environmentNames)}`;
    groups.set(key, [...(groups.get(key) ?? []), resource]);
  }
  return groups;
};

const toRow = (
  key: string,
  left: ComparableResource | undefined,
  right: ComparableResource | undefined,
): ComparisonRow => {
  const differences = left && right ? differencesBetween(left, right) : [];
  const state: ComparisonState = !left
    ? 'only_right'
    : !right
      ? 'only_left'
      : differences.length > 0
        ? 'different'
        : 'same';
  const [type, name] = key.split('|') as [ResourceType, string];
  return {
    type,
    key: name,
    state,
    left: left ? summary(left) : null,
    right: right ? summary(right) : null,
    differences,
  };
};

const isComparable = (resource: ComparableResource): boolean => !isGroupMember(resource);

export const compareResources = (
  left: readonly ComparableResource[],
  right: readonly ComparableResource[],
  environmentNames: readonly string[] = [],
): ComparisonRow[] => {
  const leftGroups = groupByKey(left.filter(isComparable), environmentNames);
  const rightGroups = groupByKey(right.filter(isComparable), environmentNames);
  const keys = [...new Set([...leftGroups.keys(), ...rightGroups.keys()])].sort();
  return keys.flatMap((key) => {
    const leftItems = leftGroups.get(key) ?? [];
    const rightItems = rightGroups.get(key) ?? [];
    return Array.from({ length: Math.max(leftItems.length, rightItems.length) }, (_, index) =>
      toRow(key, leftItems[index], rightItems[index]),
    );
  });
};
