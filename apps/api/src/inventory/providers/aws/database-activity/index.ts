import type { DatabaseActivitySource } from '../../provider';
import type { AwsKey } from '../aws-key';
import { piTopSql } from './pi-top-sql';
import { rdsPostgresLog } from './rds-postgres-log';

export const RDS_ACTIVITY_SOURCE: DatabaseActivitySource<AwsKey> = {
  resourceTypes: ['rds-cluster', 'rds-instance'],
  topSql: piTopSql,
  log: rdsPostgresLog,
};
