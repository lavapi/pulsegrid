import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import {
  LogsUnreadable,
  type DatabaseActivityContext,
  type DatabaseLogQuery,
  type RawDatabaseLogLine,
} from '../../provider';
import { isAccessDenied } from '../aws-error-messages';
import type { AwsKey } from '../aws-key';
import { LOG_LINE_LIMIT, type LogTarget, isMissingGroup, readNewestFirst } from '../aws-logs';

type Context = DatabaseActivityContext<AwsKey>;

/** CloudWatch Logs filter patterns for each choice; slow lines are what log_min_duration_statement writes. */
export const LEVEL_PATTERNS: Record<DatabaseLogQuery['level'], string | undefined> = {
  problems: '?ERROR ?FATAL ?PANIC ?WARNING',
  errors: '?ERROR ?FATAL ?PANIC',
  warnings: 'WARNING',
  deadlocks: '"deadlock detected"',
  connections: '?"authentication failed" ?"no pg_hba.conf entry"',
  all: undefined,
  slow: '"duration:"',
};

const NOT_POSTGRES = 'Only PostgreSQL logs are shown for now.';
const NOT_EXPORTED =
  "This database doesn't send its PostgreSQL log to CloudWatch Logs. Turn on log exports for postgresql in RDS to see it here.";
const DENIED = "Add logs:FilterLogEvents to the key's IAM policy to read the database log.";

const isPostgres = (engine: unknown): boolean => typeof engine === 'string' && engine.includes('postgres');

/** RDS writes a cluster's log to one group with a stream per instance, and a lone instance's to its own group. */
export const postgresLogTarget = ({ resource }: Context): LogTarget => {
  if (resource.type === 'rds-cluster') {
    return { group: `/aws/rds/cluster/${resource.name}/postgresql`, prefix: undefined };
  }
  const cluster = resource.details['cluster'];
  return typeof cluster === 'string' && cluster
    ? { group: `/aws/rds/cluster/${cluster}/postgresql`, prefix: resource.name }
    : { group: `/aws/rds/instance/${resource.name}/postgresql`, prefix: undefined };
};

/** Reads the PostgreSQL log with FilterLogEvents only, newest lines first. */
export const rdsPostgresLog = async (
  context: Context,
  { since, until, level }: DatabaseLogQuery,
): Promise<{ lines: RawDatabaseLogLine[]; partial: boolean }> => {
  if (!isPostgres(context.resource.details['engine'])) {
    throw new LogsUnreadable({ message: NOT_POSTGRES, principal: null });
  }
  const client = new CloudWatchLogsClient({
    region: context.region,
    credentials: context.credentials,
    retryMode: 'adaptive',
    maxAttempts: 5,
  });
  try {
    const lines = await readNewestFirst(client, postgresLogTarget(context), {
      since,
      until,
      pattern: LEVEL_PATTERNS[level],
    });
    return {
      lines: lines.map(({ id, timestamp, stream, message }) => ({ id, time: timestamp, instance: stream, message })),
      partial: lines.length >= LOG_LINE_LIMIT,
    };
  } catch (error) {
    if (isMissingGroup(error)) {
      throw new LogsUnreadable({ message: NOT_EXPORTED, principal: null });
    }
    if (isAccessDenied(error)) {
      throw new LogsUnreadable({ message: DENIED, principal: null });
    }
    throw error;
  }
};
