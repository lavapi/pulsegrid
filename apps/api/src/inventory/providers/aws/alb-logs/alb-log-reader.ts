import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import {
  DescribeLoadBalancerAttributesCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import type { ConnectionLogEntry, RequestLogEntry } from '@pulsegrid/shared';
import {
  LogsUnreadable,
  type RequestLogContext,
  type RequestLogPageQuery,
  type RequestLogPageResult,
  type RequestLogRange,
  type RequestLogSource,
} from '../../provider';
import { isAccessDenied } from '../aws-error-messages';
import type { AwsKey } from '../aws-key';
import {
  type AlbLogFile,
  type AlbLogKind,
  type AlbLogLocation,
  LATE_LINE_MS,
  dayKeyPrefix,
  daysOf,
  fileEnd,
  fileLoadBalancerId,
  newestFirstGroups,
  overlaps,
  startAfter,
} from './alb-log-files';
import { parseAccessLine, parseConnectionLine } from './alb-log-parser';

const FILE_SPAN_MS = 5 * 60_000;
const MAX_FILES_PER_PAGE = 120;
const MAX_FILES_WITHOUT_MATCH = 400;
const MAX_SCAN_FILES = 900;
const MAX_SCAN_LINES = 3_000_000;
const SCAN_CONCURRENCY = 8;
const ENABLED = 'true';
const NO_SUCH_BUCKET = 'NoSuchBucket';

type Context = RequestLogContext<AwsKey>;
type Parse<Entry> = (line: string) => Entry | null;

interface Positioned<Entry> {
  entry: Entry;
  key: string;
  line: number;
}

interface Cursor {
  time: string;
  key: string;
  line: number;
}

const ATTRIBUTES: Record<AlbLogKind, { enabled: string; bucket: string; prefix: string; missing: string }> = {
  access: {
    enabled: 'access_logs.s3.enabled',
    bucket: 'access_logs.s3.bucket',
    prefix: 'access_logs.s3.prefix',
    missing: "This load balancer doesn't send access logs to S3.",
  },
  connection: {
    enabled: 'connection_logs.s3.enabled',
    bucket: 'connection_logs.s3.bucket',
    prefix: 'connection_logs.s3.prefix',
    missing: "This load balancer doesn't send connection logs to S3.",
  },
};

const encodeCursor = (cursor: Cursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url');

const decodeCursor = (value: string | undefined): Cursor | null => {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor;
    return typeof parsed.time === 'string' && typeof parsed.key === 'string' && typeof parsed.line === 'number'
      ? parsed
      : null;
  } catch {
    return null;
  }
};

/** Newest first; lines with the same time keep the order of their file and position, so pages never repeat one. */
const newestFirst = (a: Cursor, b: Cursor): number =>
  b.time.localeCompare(a.time) || b.key.localeCompare(a.key) || b.line - a.line;

const positionOf = <Entry extends { time: string }>({ entry, key, line }: Positioned<Entry>): Cursor => ({
  time: entry.time,
  key,
  line,
});

const principalOf = async ({ credentials, region }: Context): Promise<string | null> => {
  try {
    return (await new STSClient({ region, credentials }).send(new GetCallerIdentityCommand({}))).Arn ?? null;
  } catch {
    return null;
  }
};

const notReadable = async (context: Context, location: AlbLogLocation, kind: AlbLogKind): Promise<LogsUnreadable> => {
  const principal = await principalOf(context);
  const folder = location.prefix ? `${location.prefix.replace(/\/+$/, '')}*` : 'AWSLogs/*';
  return new LogsUnreadable({
    message: `${kind === 'access' ? 'ALB' : 'ALB connection'} logs aren't readable yet: the bucket ${location.bucket} must grant this key s3:ListBucket and s3:GetObject on the ${folder} prefix, and the key's IAM policy must allow them.`,
    principal,
  });
};

const locate = async (context: Context, kind: AlbLogKind): Promise<AlbLogLocation> => {
  const names = ATTRIBUTES[kind];
  if (!fileLoadBalancerId(context.resource.nativeId)) {
    throw new LogsUnreadable({ message: 'Only Application Load Balancers have request logs.', principal: null });
  }
  let attributes: Map<string, string>;
  try {
    const { Attributes = [] } = await new ElasticLoadBalancingV2Client({
      region: context.region,
      credentials: context.credentials,
    }).send(new DescribeLoadBalancerAttributesCommand({ LoadBalancerArn: context.resource.nativeId }));
    attributes = new Map(Attributes.map(({ Key, Value }) => [Key ?? '', Value ?? '']));
  } catch (error) {
    if (isAccessDenied(error)) {
      throw new LogsUnreadable({
        message:
          "PulseGrid can't see where this load balancer keeps its logs: add elasticloadbalancing:DescribeLoadBalancerAttributes to the key's IAM policy.",
        principal: null,
      });
    }
    throw error;
  }
  const bucket = attributes.get(names.bucket);
  if (attributes.get(names.enabled) !== ENABLED || !bucket) {
    throw new LogsUnreadable({ message: names.missing, principal: null });
  }
  return {
    bucket,
    prefix: attributes.get(names.prefix) ?? '',
    accountId: context.accountId,
    region: context.region,
    loadBalancerArn: context.resource.nativeId,
  };
};

const s3Of = ({ region, credentials }: Context) => new S3Client({ region, credentials });

const withS3Errors = async <T>(
  context: Context,
  location: AlbLogLocation,
  kind: AlbLogKind,
  read: () => Promise<T>,
) => {
  try {
    return await read();
  } catch (error) {
    if (isAccessDenied(error)) {
      throw await notReadable(context, location, kind);
    }
    if ((error as Error).name === NO_SUCH_BUCKET) {
      throw new LogsUnreadable({ message: `The log bucket ${location.bucket} doesn't exist.`, principal: null });
    }
    throw error;
  }
};

/** The files of one load balancer whose 5 minutes overlap the range, listing only the days and keys it needs. */
const listFiles = async (
  context: Context,
  location: AlbLogLocation,
  kind: AlbLogKind,
  from: number,
  to: number,
): Promise<AlbLogFile[]> => {
  const s3 = s3Of(context);
  const files: AlbLogFile[] = [];
  for (const day of daysOf(from, to)) {
    const prefix = dayKeyPrefix(location, kind, day);
    if (!prefix) {
      return [];
    }
    let token: string | undefined;
    let pastRange = false;
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: location.bucket,
          Prefix: prefix,
          StartAfter: token ? undefined : startAfter(prefix, from - FILE_SPAN_MS),
          ContinuationToken: token,
        }),
      );
      for (const { Key } of page.Contents ?? []) {
        const endsAt = Key ? fileEnd(Key) : null;
        if (!Key || endsAt === null) {
          continue;
        }
        if (endsAt - FILE_SPAN_MS > to + LATE_LINE_MS) {
          pastRange = true;
          break;
        }
        if (overlaps(endsAt, from, to)) {
          files.push({ key: Key, endsAt });
        }
      }
      token = pastRange ? undefined : page.NextContinuationToken;
    } while (token);
  }
  return files;
};

/** Streams one gzip file line by line, without holding the whole file in memory. */
const eachLine = async (
  context: Context,
  bucket: string,
  key: string,
  visit: (line: string, index: number) => boolean | void,
): Promise<void> => {
  const { Body } = await s3Of(context).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!Body) {
    return;
  }
  const lines = createInterface({ input: (Body as Readable).pipe(createGunzip()), crlfDelay: Infinity });
  let index = 0;
  for await (const line of lines) {
    if (visit(line, index) === false) {
      lines.close();
      (Body as Readable).destroy();
      return;
    }
    index += 1;
  }
};

const inRange = (time: string, from: number, to: number): boolean => {
  const at = Date.parse(time);
  return at >= from && at <= to;
};

const readPage = async <Entry extends { time: string }>(
  context: Context,
  kind: AlbLogKind,
  parse: Parse<Entry>,
  { from, to, matches, before, limit }: RequestLogPageQuery<Entry>,
): Promise<RequestLogPageResult<Entry>> => {
  const location = await locate(context, kind);
  return withS3Errors(context, location, kind, async () => {
    const start = from.getTime();
    const end = to.getTime();
    const cursor = decodeCursor(before);
    const cursorAt = cursor ? Date.parse(cursor.time) : Number.POSITIVE_INFINITY;
    const groups = newestFirstGroups(await listFiles(context, location, kind, start, end));
    let collected: Positioned<Entry>[] = [];
    let filesRead = 0;
    let stoppedAt: number | null = null;
    for (const group of groups) {
      const groupEnd = group[0]?.endsAt ?? 0;
      if (groupEnd - FILE_SPAN_MS - LATE_LINE_MS > cursorAt) {
        continue;
      }
      if (collected.length >= limit) {
        collected = collected.sort((a, b) => newestFirst(positionOf(a), positionOf(b))).slice(0, limit);
        const last = collected[limit - 1];
        if (last && groupEnd + LATE_LINE_MS < Date.parse(last.entry.time)) {
          break;
        }
      }
      const budget = collected.length > 0 ? MAX_FILES_PER_PAGE : MAX_FILES_WITHOUT_MATCH;
      if (filesRead + group.length > budget) {
        stoppedAt = groupEnd;
        break;
      }
      filesRead += group.length;
      const found = await Promise.all(
        group.map(async ({ key }) => {
          const entries: Positioned<Entry>[] = [];
          await eachLine(context, location.bucket, key, (line, index) => {
            const entry = parse(line);
            if (!entry || !inRange(entry.time, start, end) || !matches(entry)) {
              return;
            }
            const positioned = { entry, key, line: index };
            if (!cursor || newestFirst(cursor, positionOf(positioned)) < 0) {
              entries.push(positioned);
            }
          });
          return entries;
        }),
      );
      collected.push(...found.flat());
    }
    const page = collected.sort((a, b) => newestFirst(positionOf(a), positionOf(b))).slice(0, limit);
    const last = page.at(-1);
    let older: string | null = null;
    if (last && (page.length === limit || stoppedAt !== null)) {
      older = encodeCursor(positionOf(last));
    } else if (stoppedAt !== null) {
      older = encodeCursor({ time: new Date(stoppedAt + LATE_LINE_MS).toISOString(), key: '', line: -1 });
    }
    return { entries: page.map(({ entry }) => entry), older };
  });
};

/** Reads every request in the range, newest files first, stopping at a budget so a busy day can't run forever. */
const scanRequests = async (
  context: Context,
  { from, to, matches }: RequestLogRange<RequestLogEntry>,
  visit: (entry: RequestLogEntry) => void,
): Promise<{ partial: boolean }> => {
  const location = await locate(context, 'access');
  return withS3Errors(context, location, 'access', async () => {
    const start = from.getTime();
    const end = to.getTime();
    const files = newestFirstGroups(await listFiles(context, location, 'access', start, end)).flat();
    const chosen = files.slice(0, MAX_SCAN_FILES);
    let lines = 0;
    let partial = files.length > chosen.length;
    let next = 0;
    const worker = async () => {
      while (next < chosen.length && !partial) {
        const file = chosen[next];
        next += 1;
        if (!file) {
          return;
        }
        await eachLine(context, location.bucket, file.key, (line) => {
          lines += 1;
          if (lines > MAX_SCAN_LINES) {
            partial = true;
            return false;
          }
          const entry = parseAccessLine(line);
          if (entry && inRange(entry.time, start, end) && matches(entry)) {
            visit(entry);
          }
          return true;
        });
      }
    };
    await Promise.all(Array.from({ length: SCAN_CONCURRENCY }, worker));
    return { partial };
  });
};

export const ALB_REQUEST_LOG_SOURCE: RequestLogSource<AwsKey> = {
  resourceType: 'load-balancer',
  requests: (context, query) => readPage<RequestLogEntry>(context, 'access', parseAccessLine, query),
  scanRequests,
  connections: (context, query) => readPage<ConnectionLogEntry>(context, 'connection', parseConnectionLine, query),
};
