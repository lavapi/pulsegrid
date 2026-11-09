import type { AWS_SERVICES } from '@pulsegrid/shared';

export interface ServicePermission {
  service: keyof typeof AWS_SERVICES;
  readAction: string;
  manageAction: string;
}

export const SERVICE_PERMISSIONS: readonly ServicePermission[] = [
  { service: 'ecs', readAction: 'ecs:ListClusters', manageAction: 'ecs:DeleteService' },
  { service: 'rds', readAction: 'rds:DescribeDBInstances', manageAction: 'rds:DeleteDBInstance' },
  {
    service: 'elasticache',
    readAction: 'elasticache:DescribeCacheClusters',
    manageAction: 'elasticache:DeleteCacheCluster',
  },
  { service: 's3', readAction: 's3:ListAllMyBuckets', manageAction: 's3:CreateBucket' },
  {
    service: 'secrets',
    readAction: 'secretsmanager:ListSecrets',
    manageAction: 'secretsmanager:DeleteSecret',
  },
  { service: 'ec2', readAction: 'ec2:DescribeInstances', manageAction: 'ec2:TerminateInstances' },
  {
    service: 'network',
    readAction: 'ec2:DescribeVpcs',
    manageAction: 'ec2:AuthorizeSecurityGroupIngress',
  },
];
