import type { CloudProviderDefinition } from '../cloud-providers';

export const AWS_RESOURCE_TYPES = {
  'ecs-cluster': { label: 'Clusters', service: 'ecs', category: 'ecs' },
  'ecs-service': { label: 'Services', service: 'ecs', category: 'ecs' },
  'rds-cluster': { label: 'Clusters', service: 'rds', category: 'rds' },
  'rds-instance': { label: 'Instances', service: 'rds', category: 'rds' },
  'elasticache-replication-group': {
    label: 'Replication groups',
    service: 'elasticache',
    category: 'elasticache',
  },
  'elasticache-cluster': { label: 'Nodes', service: 'elasticache', category: 'elasticache' },
  'ec2-instance': { label: 'Instances', service: 'ec2', category: 'ec2' },
  's3-bucket': { label: 'Buckets', service: 's3', category: 's3' },
  'secrets-manager-secret': { label: 'Secrets', service: 'secrets', category: 'secrets-manager' },
  'load-balancer': { label: 'Load balancers', service: 'network', category: 'load-balancing' },
  vpc: { label: 'VPCs', service: 'network', category: 'vpc' },
  subnet: { label: 'Subnets', service: 'network', category: 'vpc' },
  'security-group': { label: 'Security groups', service: 'network', category: 'vpc' },
} as const;

export const AWS_SERVICE_CATEGORIES = {
  ecs: { label: 'ECS', description: 'Containers and clusters', provider: 'aws' },
  rds: { label: 'RDS', description: 'Relational databases', provider: 'aws' },
  elasticache: { label: 'ElastiCache', description: 'In-memory caching', provider: 'aws' },
  ec2: { label: 'EC2', description: 'Virtual machines', provider: 'aws' },
  s3: { label: 'S3', description: 'Object storage', provider: 'aws' },
  'secrets-manager': { label: 'Secrets Manager', description: 'App secrets and keys', provider: 'aws' },
  'load-balancing': { label: 'Load Balancing', description: 'Traffic distribution', provider: 'aws' },
  vpc: { label: 'VPC', description: 'Networks, subnets and security groups', provider: 'aws' },
} as const;

export const AWS_SERVICES = {
  ecs: 'ECS',
  rds: 'RDS',
  elasticache: 'ElastiCache',
  s3: 'S3',
  secrets: 'Secrets Manager',
  ec2: 'EC2',
  network: 'Network',
} as const;

export const AWS_READ_ONLY_ACTIONS = [
  'ecs:ListClusters',
  'ecs:DescribeClusters',
  'ecs:ListServices',
  'ecs:DescribeServices',
  'ecs:ListTagsForResource',
  'ecs:DescribeTaskDefinition',
  'logs:FilterLogEvents',
  'cloudwatch:GetMetricData',
  'fis:ListExperimentTemplates',
  'fis:GetExperimentTemplate',
  'fis:ListExperiments',
  'fis:GetExperiment',
  'fis:ListExperimentResolvedTargets',
  'rds:DescribeDBInstances',
  'rds:DescribeDBClusters',
  'elasticache:DescribeReplicationGroups',
  'elasticache:DescribeCacheClusters',
  'elasticache:DescribeCacheSubnetGroups',
  'elasticache:ListTagsForResource',
  'cloudtrail:LookupEvents',
  'ce:GetCostAndUsage',
  's3:ListAllMyBuckets',
  's3:GetBucketLocation',
  's3:GetBucketTagging',
  'secretsmanager:ListSecrets',
  'ec2:DescribeInstances',
  'ec2:DescribeVpcs',
  'ec2:DescribeSubnets',
  'ec2:DescribeSecurityGroups',
  'ec2:DescribeRouteTables',
  'elasticloadbalancing:DescribeLoadBalancers',
  'elasticloadbalancing:DescribeTags',
  'elasticloadbalancing:DescribeTargetGroups',
  'elasticloadbalancing:DescribeTargetHealth',
  'iam:SimulatePrincipalPolicy',
] as const;

export const AWS_READ_ONLY_POLICY = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Action: AWS_READ_ONLY_ACTIONS, Resource: '*' }],
  },
  null,
  2,
);

export const AWS_CHANGE_ACTIONS = [
  'ecs:UpdateService',
  'rds:RebootDBInstance',
  'elasticache:RebootCacheCluster',
  'ec2:RebootInstances',
  'ec2:DescribeInstanceStatus',
  'secretsmanager:GetSecretValue',
  'secretsmanager:PutSecretValue',
  'fis:StartExperiment',
  'fis:StopExperiment',
] as const;

export const AWS_ACTIONS_POLICY = JSON.stringify(
  {
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: AWS_READ_ONLY_ACTIONS, Resource: '*' },
      { Effect: 'Allow', Action: AWS_CHANGE_ACTIONS, Resource: '*' },
    ],
  },
  null,
  2,
);

export const AWS_PROVIDER: CloudProviderDefinition = {
  id: 'aws',
  label: 'AWS',
  description: 'Read infrastructure with an access key for each account',
  icon: '/cloud-icons/aws/logo.svg',
  accountLabel: 'AWS account',
  credentialFields: [
    { key: 'accessKeyId', label: 'Access Key ID', secret: false, placeholder: 'AKIA…' },
    {
      key: 'secretAccessKey',
      label: 'Secret Access Key',
      secret: true,
      hint: 'Stored encrypted, and never shown again',
    },
  ],
  defaultRegion: 'eu-central-1',
  regions: [
    'eu-central-1',
    'eu-west-1',
    'eu-west-2',
    'eu-north-1',
    'us-east-1',
    'us-east-2',
    'us-west-2',
    'ap-southeast-1',
  ],
  setup: {
    title: 'Read-only IAM policy',
    description:
      "Create a dedicated IAM user with this policy for each account. Don't use personal or admin keys. It can read service logs, costs and, through task definitions, plain environment variables.",
    code: AWS_READ_ONLY_POLICY,
  },
  actionsSetup: {
    title: 'IAM policy with actions',
    description:
      'Use this on non-production accounts to allow force deploys, reboots and secret changes. It adds only those actions, and the check that a server came back. A secret with its own KMS key must also allow this user.',
    code: AWS_ACTIONS_POLICY,
  },
};
