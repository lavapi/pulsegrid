import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import {
  DescribeLoadBalancerAttributesCommand,
  ElasticLoadBalancingV2Client,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import type { RequestLogEntry } from '@pulsegrid/shared';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { LogsUnreadable } from '../../provider';
import { ALB_REQUEST_LOG_SOURCE } from './alb-log-reader';

const ACCOUNT = '111111111111';
const ARN = `arn:aws:elasticloadbalancing:eu-central-1:${ACCOUNT}:loadbalancer/app/game-alb/50dc6c495c0c9188`;
const DAY = `game-staging/AWSLogs/${ACCOUNT}/elasticloadbalancing/eu-central-1/2026/11/11/`;
const NAME = `${ACCOUNT}_elasticloadbalancing_eu-central-1_app.game-alb.50dc6c495c0c9188_`;
const context = {
  credentials: { accessKeyId: 'a', secretAccessKey: 'b' },
  region: 'eu-central-1',
  accountId: ACCOUNT,
  resource: { nativeId: ARN, name: 'game-alb' },
};

const elb = mockClient(ElasticLoadBalancingV2Client);
const s3 = mockClient(S3Client);
const sts = mockClient(STSClient);

const line = (time: string, path: string) =>
  `https ${time} app/game-alb/50dc 172.70.1.9:1 10.0.0.1:80 0.000 0.010 0.000 200 200 1 1 "GET https://api.example.com:443${path} HTTP/1.1" "ua" - - arn:aws:elasticloadbalancing:eu-central-1:${ACCOUNT}:targetgroup/game-api/1 "Root=1" "api.example.com" "-" 0 ${time} "forward" "-" "-" "-" "-" "-" "-" TID`;

/** Two 5-minute files from two nodes each, every line a minute apart. */
const FILES: Record<string, string[]> = {
  [`${DAY}${NAME}20261111T1005Z_10.0.0.1_a.log.gz`]: [line('2026-11-11T10:01:00.000000Z', '/a1'), line('2026-11-11T10:03:00.000000Z', '/a3')],
  [`${DAY}${NAME}20261111T1005Z_10.0.0.2_b.log.gz`]: [line('2026-11-11T10:02:00.000000Z', '/b2')],
  [`${DAY}${NAME}20261111T1010Z_10.0.0.1_c.log.gz`]: [line('2026-11-11T10:06:00.000000Z', '/c6'), line('2026-11-11T10:08:00.000000Z', '/c8')],
  [`${DAY}${NAME}20261111T1010Z_10.0.0.2_d.log.gz`]: [line('2026-11-11T10:07:00.000000Z', '/d7')],
};

const range = { from: new Date('2026-11-11T10:00:00Z'), to: new Date('2026-11-11T10:10:00Z') };
const everything = () => true;

describe('ALB_REQUEST_LOG_SOURCE', () => {
  beforeEach(() => {
    [elb, s3, sts].forEach((client) => client.reset());
    elb.on(DescribeLoadBalancerAttributesCommand).resolves({
      Attributes: [
        { Key: 'access_logs.s3.enabled', Value: 'true' },
        { Key: 'access_logs.s3.bucket', Value: 'game-alb-logs-222222222222' },
        { Key: 'access_logs.s3.prefix', Value: 'game-staging' },
      ],
    });
    s3.on(ListObjectsV2Command).resolves({ Contents: Object.keys(FILES).map((Key) => ({ Key })) });
    s3.on(GetObjectCommand).callsFake(({ Key }: { Key: string }) => ({
      Body: Readable.from([gzipSync(`${(FILES[Key] ?? []).join('\n')}\n`)]),
    }));
    sts.on(GetCallerIdentityCommand).resolves({ Arn: `arn:aws:iam::${ACCOUNT}:user/pulsegrid` });
  });

  it('pages newest first and goes on from the cursor without repeating a line', async () => {
    const paths = (entries: RequestLogEntry[]) => entries.map(({ path }) => path);
    const first = await ALB_REQUEST_LOG_SOURCE.requests(context, { ...range, before: undefined, limit: 4, matches: everything });
    expect(paths(first.entries)).toEqual(['/c8', '/d7', '/c6', '/a3']);
    expect(first.older).not.toBeNull();
    const second = await ALB_REQUEST_LOG_SOURCE.requests(context, {
      ...range,
      before: first.older ?? undefined,
      limit: 4,
      matches: everything,
    });
    expect(paths(second.entries)).toEqual(['/b2', '/a1']);
    expect(second.older).toBeNull();
    expect(s3.commandCalls(ListObjectsV2Command)[0]?.args[0].input).toMatchObject({
      Bucket: 'game-alb-logs-222222222222',
      Prefix: `${DAY}${NAME}`,
      StartAfter: `${DAY}${NAME}20261111T0955Z`,
    });
  });

  it('applies the filter while reading, and stays inside the range', async () => {
    const page = await ALB_REQUEST_LOG_SOURCE.requests(context, {
      from: new Date('2026-11-11T10:02:30Z'),
      to: new Date('2026-11-11T10:07:30Z'),
      before: undefined,
      limit: 10,
      matches: ({ path }) => path !== '/c6',
    });
    expect(page.entries.map(({ path }) => path)).toEqual(['/d7', '/a3']);
  });

  it('visits every request in the range for the summary', async () => {
    const seen: string[] = [];
    const { partial } = await ALB_REQUEST_LOG_SOURCE.scanRequests(context, { ...range, matches: everything }, ({ path }) =>
      seen.push(path),
    );
    expect(seen.sort()).toEqual(['/a1', '/a3', '/b2', '/c6', '/c8', '/d7']);
    expect(partial).toBe(false);
  });

  it('says which identity the bucket must grant when it refuses access', async () => {
    s3.on(ListObjectsV2Command).rejects(Object.assign(new Error('raw'), { name: 'AccessDenied' }));
    const error = await ALB_REQUEST_LOG_SOURCE.requests(context, { ...range, before: undefined, limit: 4, matches: everything }).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(LogsUnreadable);
    expect((error as LogsUnreadable).problem).toEqual({
      message:
        "ALB logs aren't readable yet: the bucket game-alb-logs-222222222222 must grant this key s3:ListBucket and s3:GetObject on the game-staging* prefix, and the key's IAM policy must allow them.",
      principal: `arn:aws:iam::${ACCOUNT}:user/pulsegrid`,
    });
  });

  it('explains when logs are off, or the load balancer has none', async () => {
    elb.on(DescribeLoadBalancerAttributesCommand).resolves({ Attributes: [{ Key: 'access_logs.s3.enabled', Value: 'false' }] });
    await expect(
      ALB_REQUEST_LOG_SOURCE.requests(context, { ...range, before: undefined, limit: 4, matches: everything }),
    ).rejects.toThrow("This load balancer doesn't send access logs to S3.");
    const network = { ...context, resource: { ...context.resource, nativeId: ARN.replace('/app/', '/net/') } };
    await expect(
      ALB_REQUEST_LOG_SOURCE.requests(network, { ...range, before: undefined, limit: 4, matches: everything }),
    ).rejects.toThrow('Only Application Load Balancers have request logs.');
  });
});
