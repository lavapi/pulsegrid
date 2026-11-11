import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  type FilteredLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import { DescribeTaskDefinitionCommand, ECSClient } from '@aws-sdk/client-ecs';
import type { LogLine } from '@pulsegrid/shared';
import type { LogResult, LogSource } from '../provider';
import type { AwsKey } from './aws-key';

const LINE_LIMIT = 500;
const PAGE_SIZE = 1000;
const PAGES_PER_WINDOW = 3;
const FIRST_WINDOW_MS = 5 * 60 * 1000;
const AWS_LOGS_DRIVER = 'awslogs';
const MISSING_LOG_GROUP = 'ResourceNotFoundException';

export interface LogTarget {
  group: string;
  prefix: string | undefined;
}

export interface LogWindow {
  since: Date;
  until: Date;
  /** A CloudWatch Logs filter pattern. */
  pattern: string | undefined;
}

const toLine = ({ eventId, timestamp, logStreamName, message }: FilteredLogEvent): LogLine => ({
  id: eventId ?? '',
  timestamp: new Date(timestamp ?? 0).toISOString(),
  stream: logStreamName ?? '',
  message: message ?? '',
});

const logTarget = async (
  credentials: AwsKey,
  region: string,
  taskDefinition: string,
): Promise<LogTarget | null> => {
  const { taskDefinition: definition } = await new ECSClient({ region, credentials }).send(
    new DescribeTaskDefinitionCommand({ taskDefinition }),
  );
  const options = definition?.containerDefinitions?.find(
    ({ logConfiguration }) => logConfiguration?.logDriver === AWS_LOGS_DRIVER,
  )?.logConfiguration?.options;
  const group = options?.['awslogs-group'];
  if (!group) {
    return null;
  }
  const prefix = options['awslogs-stream-prefix'];
  return { group, prefix: prefix ? `${prefix}/` : undefined };
};

const readWindow = async (
  client: CloudWatchLogsClient,
  { group, prefix }: LogTarget,
  pattern: string | undefined,
  start: number,
  end: number,
): Promise<LogLine[]> => {
  const lines: LogLine[] = [];
  let token: string | undefined;
  for (let page = 0; page < PAGES_PER_WINDOW; page += 1) {
    const { events = [], nextToken } = await client.send(
      new FilterLogEventsCommand({
        logGroupName: group,
        logStreamNamePrefix: prefix,
        startTime: start,
        endTime: end,
        limit: PAGE_SIZE,
        filterPattern: pattern,
        nextToken: token,
      }),
    );
    lines.push(...events.map(toLine));
    token = nextToken;
    if (!token) {
      break;
    }
  }
  return lines;
};

/** The newest lines first, reading ever larger windows back in time until there are enough. Up to 500 lines. */
export const readNewestFirst = async (
  client: CloudWatchLogsClient,
  target: LogTarget,
  { since, until, pattern }: LogWindow,
): Promise<LogLine[]> => {
  const earliest = since.getTime();
  let end = until.getTime();
  let size = FIRST_WINDOW_MS;
  let lines: LogLine[] = [];
  while (end > earliest && lines.length < LINE_LIMIT) {
    const start = Math.max(earliest, end - size);
    lines = [...(await readWindow(client, target, pattern, start, end - 1)), ...lines];
    end = start;
    size *= 2;
  }
  return lines.slice(-LINE_LIMIT);
};

export const LOG_LINE_LIMIT = LINE_LIMIT;

export const isMissingGroup = (error: unknown): boolean => (error as Error).name === MISSING_LOG_GROUP;

export const AWS_LOG_SOURCE: LogSource<AwsKey> = {
  resourceType: 'ecs-service',
  read: async ({ credentials, region, resource }, query): Promise<LogResult> => {
    const taskDefinition = resource.details['taskDefinition'];
    const target =
      typeof taskDefinition === 'string'
        ? await logTarget(credentials, region, taskDefinition)
        : null;
    if (!target) {
      return { available: false, lines: [] };
    }
    const client = new CloudWatchLogsClient({ region, credentials });
    try {
      return {
        available: true,
        lines: await readNewestFirst(client, target, {
          since: query.since,
          until: query.until,
          pattern: query.search ? JSON.stringify(query.search) : undefined,
        }),
      };
    } catch (error) {
      if (isMissingGroup(error)) {
        return { available: false, lines: [] };
      }
      throw error;
    }
  },
};
