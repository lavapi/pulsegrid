import {
  RESOURCE_TYPES,
  type Resource,
  type ResourceType,
  resourceTypeLabel,
  resourceTypesIn,
  SERVICE_CATEGORIES,
  type ServiceCategorySummary,
} from '@pulsegrid/shared';
import { formatTime } from './format';

export interface ResourceColumn {
  label: string;
  value: (resource: Resource) => string;
  timeOf?: (resource: Resource) => string | null;
}

const EMPTY = '—';

const text =
  (key: string) =>
  ({ details }: Resource): string => {
    const value = details[key];
    return value === undefined || value === null || value === '' ? EMPTY : String(value);
  };

const yesNo =
  (key: string) =>
  ({ details }: Resource): string => {
    const value = details[key];
    if (typeof value !== 'boolean') {
      return value === 'enabled' ? 'Yes' : value === 'disabled' ? 'No' : EMPTY;
    }
    return value ? 'Yes' : 'No';
  };

const engine = ({ details }: Resource): string =>
  [details['engine'], details['engineVersion']].filter(Boolean).join(' ') || EMPTY;

const LAUNCH_LABELS: Record<string, string> = {
  FARGATE: 'Fargate',
  FARGATE_SPOT: 'Fargate Spot',
  EC2: 'EC2',
  EXTERNAL: 'External',
};

const launchLabel = (name: string): string => LAUNCH_LABELS[name] ?? name;

export const formatLaunchType = (value: unknown): string =>
  typeof value === 'string' && value
    ? value.split(', ').map(launchLabel).join(', ')
    : EMPTY;

export const formatDeployment = (state: unknown): string => {
  if (typeof state !== 'string' || !state) {
    return EMPTY;
  }
  const words = state.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const tasks = ({ details }: Resource): string =>
  `${String(details['runningTasks'] ?? 0)} of ${String(details['desiredTasks'] ?? 0)}`;

const time =
  (key: string) =>
  ({ details }: Resource): string => {
    const value = details[key];
    return typeof value === 'string' ? formatTime(value) : EMPTY;
  };

const column = (label: string, value: ResourceColumn['value']): ResourceColumn => ({ label, value });

const timeColumn = (label: string, key: string): ResourceColumn => ({
  ...column(label, time(key)),
  timeOf: ({ details }) => {
    const value = details[key];
    return typeof value === 'string' ? value : null;
  },
});

export const TYPE_COLUMN: ResourceColumn = {
  label: 'Type',
  value: ({ type }) => resourceTypeLabel(type),
};

export const RESOURCE_COLUMNS: Record<ResourceType, ResourceColumn[]> = {
  'ecs-cluster': [
    column('Active services', text('activeServices')),
    column('Running tasks', text('runningTasks')),
    column('Pending tasks', text('pendingTasks')),
  ],
  'ecs-service': [
    column('Cluster', text('cluster')),
    column('Running tasks', tasks),
    column('Launch type', ({ details }) => formatLaunchType(details['launchType'])),
    column('Task definition', text('taskDefinition')),
    column('Deployment', ({ details }) => formatDeployment(details['rolloutState'])),
  ],
  'rds-cluster': [
    column('Engine', engine),
    column('Members', text('members')),
    column('Multi-AZ', yesNo('multiAz')),
    column('Encrypted', yesNo('storageEncrypted')),
  ],
  'rds-instance': [
    column('Engine', engine),
    column('Class', text('instanceClass')),
    column('Storage GB', text('storageGb')),
    column('Multi-AZ', yesNo('multiAz')),
    column('Encrypted', yesNo('storageEncrypted')),
    column('Public', yesNo('publiclyAccessible')),
  ],
  'elasticache-replication-group': [
    column('Node type', text('nodeType')),
    column('Members', text('members')),
    column('Failover', text('automaticFailover')),
    column('Multi-AZ', yesNo('multiAz')),
    column('Encrypted in transit', yesNo('encryptedInTransit')),
  ],
  'elasticache-cluster': [
    column('Engine', engine),
    column('Node type', text('nodeType')),
    column('Nodes', text('nodes')),
    column('Replication group', text('replicationGroup')),
  ],
  'ec2-instance': [
    column('Instance type', text('instanceType')),
    column('Zone', text('availabilityZone')),
    column('Private IP', text('privateIp')),
    column('Public IP', text('publicIp')),
  ],
  's3-bucket': [timeColumn('Created', 'createdAt')],
  'secrets-manager-secret': [
    column('Description', text('description')),
    timeColumn('Last changed', 'lastChangedAt'),
    column('Rotation', yesNo('rotationEnabled')),
    column('Managed by', text('managedBy')),
  ],
  'load-balancer': [
    column('Type', text('type')),
    column('Scheme', text('scheme')),
    column('DNS name', text('dnsName')),
  ],
  vpc: [column('CIDR', text('cidrBlock')), column('Default', yesNo('isDefault'))],
  subnet: [
    column('VPC', text('vpcId')),
    column('CIDR', text('cidrBlock')),
    column('Zone', text('availabilityZone')),
    column('Free IPs', text('availableIps')),
    column('Public IP on launch', yesNo('publicIpOnLaunch')),
  ],
  'security-group': [
    column('VPC', text('vpcId')),
    column('Inbound rules', text('inboundRules')),
    column('Outbound rules', text('outboundRules')),
    column('Open to internet', yesNo('openToInternet')),
  ],
};

const countNoun = (type: ResourceType, count: number): string => {
  const { label } = RESOURCE_TYPES[type];
  const noun = type === 'vpc' ? label : label.toLowerCase();
  return count === 1 ? noun.replace(/s$/, '') : noun;
};

export const countSummary = ({ category, types }: ServiceCategorySummary): string =>
  resourceTypesIn(category)
    .flatMap((type) => {
      const count = types.find((item) => item.type === type)?.count;
      return count ? [`${count} ${countNoun(type, count)}`] : [];
    })
    .join(' · ');

export const categoryTitle = ({ category, launchTypes }: ServiceCategorySummary): string => {
  const { label } = SERVICE_CATEGORIES[category];
  return launchTypes.length > 0 ? `${label} (${launchTypes.map(launchLabel).join(', ')})` : label;
};
