import type { ResourceCollector } from '../../provider';
import type { AwsKey } from '../aws-key';
import { ec2Collector } from './ec2.collector';
import { ecsCollector } from './ecs.collector';
import { elastiCacheCollector } from './elasticache.collector';
import { networkCollector } from './network.collector';
import { rdsCollector } from './rds.collector';
import { s3Collector } from './s3.collector';
import { secretsCollector } from './secrets.collector';

export const AWS_COLLECTORS: readonly ResourceCollector<AwsKey>[] = [
  ecsCollector,
  rdsCollector,
  elastiCacheCollector,
  s3Collector,
  secretsCollector,
  ec2Collector,
  networkCollector,
];
