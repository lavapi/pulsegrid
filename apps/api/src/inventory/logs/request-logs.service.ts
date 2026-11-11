import {
  type ConnectionLogPage,
  REQUEST_LOG_MAX_MINUTES,
  type RequestLogFilter,
  type RequestLogPage,
  type RequestLogSummary,
} from '@pulsegrid/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import type { CloudProvider, RequestLogContext } from '../providers/provider';
import { ALLOWED, type LogReadTarget, LogReads } from './log-reads';
import { requestMatcher, shown } from './request-log-filter';
import { RequestStatsCollector } from './request-log-stats';

const PAGE_SIZE = 100;
const MS_PER_MINUTE = 60_000;
const KEPT_DAYS_MS = 90 * 24 * 60 * MS_PER_MINUTE;
const BAD_RANGE = 'Choose a time range of up to 24 hours within the last 90 days.';

const supportsRequestLogs = (provider: CloudProvider, type: string): boolean =>
  provider.requestLogSource?.resourceType === type;

const contextOf = ({ resource, account, credentials }: LogReadTarget): RequestLogContext => ({
  credentials,
  region: resource.region,
  accountId: account.account_id,
  resource: { nativeId: resource.native_id, name: resource.name },
});

/** The range as dates, refusing ranges over 24 hours, in the future, or older than the logs are kept. */
export const boundedRange = (from: string, to: string, now = new Date()): { from: Date; to: Date } => {
  const start = new Date(from);
  const end = new Date(Math.min(new Date(to).getTime(), now.getTime()));
  const span = end.getTime() - start.getTime();
  if (
    Number.isNaN(span) ||
    span <= 0 ||
    span > REQUEST_LOG_MAX_MINUTES * MS_PER_MINUTE ||
    start.getTime() < now.getTime() - KEPT_DAYS_MS
  ) {
    throw new BadRequestException(BAD_RANGE);
  }
  return { from: start, to: end };
};

const emptySummary = (problem: RequestLogSummary['problem'], access = ALLOWED): RequestLogSummary => ({
  access,
  problem,
  requests: 0,
  errorRate: 0,
  p50Ms: null,
  p95Ms: null,
  p99Ms: null,
  topPaths: [],
  topHosts: [],
  noTarget: 0,
  partial: false,
});

/** A load balancer's request and connection logs, read from where it keeps them, when someone looks. */
@Injectable()
export class RequestLogsService {
  constructor(private readonly reads: LogReads) {}

  async requests(
    auth: AuthContext,
    id: string,
    filter: RequestLogFilter,
    ip: string | undefined,
  ): Promise<RequestLogPage> {
    const range = boundedRange(filter.from, filter.to);
    const start = await this.reads.start(auth, id, supportsRequestLogs, ip);
    if (start.kind === 'blocked') {
      return { access: start.access, problem: start.problem, entries: [], older: null, canShowQuery: false };
    }
    const { target } = start;
    const showQuery = Boolean(filter.showQuery) && target.sensitive;
    const matching = { ...filter, showQuery };
    try {
      const { entries, older } = await this.source(target).requests(contextOf(target), {
        ...range,
        before: filter.before,
        limit: PAGE_SIZE,
        matches: requestMatcher(matching),
      });
      return {
        access: ALLOWED,
        problem: null,
        entries: entries.map((entry) => shown(entry, showQuery)),
        older,
        canShowQuery: target.sensitive,
      };
    } catch (error) {
      return {
        access: ALLOWED,
        problem: this.reads.problemOf(error),
        entries: [],
        older: null,
        canShowQuery: target.sensitive,
      };
    }
  }

  async summary(
    auth: AuthContext,
    id: string,
    filter: RequestLogFilter,
    ip: string | undefined,
  ): Promise<RequestLogSummary> {
    const range = boundedRange(filter.from, filter.to);
    const start = await this.reads.start(auth, id, supportsRequestLogs, ip);
    if (start.kind === 'blocked') {
      return emptySummary(start.problem, start.access);
    }
    const { target } = start;
    const showQuery = Boolean(filter.showQuery) && target.sensitive;
    const stats = new RequestStatsCollector(showQuery);
    try {
      const { partial } = await this.source(target).scanRequests(
        contextOf(target),
        { ...range, matches: requestMatcher({ ...filter, showQuery }) },
        stats.add,
      );
      return { access: ALLOWED, problem: null, ...stats.result(), partial };
    } catch (error) {
      return emptySummary(this.reads.problemOf(error));
    }
  }

  async connections(
    auth: AuthContext,
    id: string,
    filter: { from: string; to: string; before?: string | undefined; failedOnly?: boolean | undefined },
    ip: string | undefined,
  ): Promise<ConnectionLogPage> {
    const range = boundedRange(filter.from, filter.to);
    const start = await this.reads.start(auth, id, supportsRequestLogs, ip);
    if (start.kind === 'blocked') {
      return { access: start.access, problem: start.problem, entries: [], older: null };
    }
    try {
      const { entries, older } = await this.source(start.target).connections(contextOf(start.target), {
        ...range,
        before: filter.before,
        limit: PAGE_SIZE,
        matches: ({ result }) => !filter.failedOnly || result !== 'Success',
      });
      return { access: ALLOWED, problem: null, entries, older };
    } catch (error) {
      return { access: ALLOWED, problem: this.reads.problemOf(error), entries: [], older: null };
    }
  }

  private source({ provider }: LogReadTarget) {
    const source = provider.requestLogSource;
    if (!source) {
      throw new BadRequestException("This resource doesn't have request logs.");
    }
    return source;
  }
}
