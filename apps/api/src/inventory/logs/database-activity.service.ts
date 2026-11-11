import { type DatabaseLogLevel, type DatabaseLogView, QUERY_ACTIVITY_RANGES, type TopSqlView } from '@pulsegrid/shared';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/session/auth-context';
import type {
  CloudProvider,
  DatabaseActivityContext,
  DatabaseActivitySource,
  RawDatabaseLogLine,
} from '../providers/provider';
import { ALLOWED, type LogReadTarget, LogReads } from './log-reads';
import { hideLogValues, hideStatementValues, parsePostgresLine, parseSlowQuery } from './postgres-log';

const MS_PER_MINUTE = 60_000;
const LOG_RANGE_MINUTES = 24 * 60;

const supportsActivity = (provider: CloudProvider, type: string): boolean =>
  (provider.databaseActivitySource?.resourceTypes as readonly string[] | undefined)?.includes(type) ?? false;

const contextOf = ({ resource, credentials }: LogReadTarget): DatabaseActivityContext => ({
  credentials,
  region: resource.region,
  resource: {
    type: resource.type as DatabaseActivityContext['resource']['type'],
    name: resource.name,
    details: resource.details,
  },
});

const rangeMinutes = (range: string): number => {
  const found = QUERY_ACTIVITY_RANGES.find(({ id }) => id === range);
  if (!found) {
    throw new BadRequestException('Choose one of the time ranges shown.');
  }
  return found.minutes;
};

const toLines = (raw: readonly RawDatabaseLogLine[], search: string | undefined, sensitive: boolean) => {
  const wanted = search?.toLowerCase();
  return raw
    .map(({ id, time, instance, message }) => {
      const line = parsePostgresLine(message);
      const text = sensitive ? line.text : hideLogValues(line);
      return { id, time, instance, severity: line.severity, message: line.session ? `${line.session} ${text}` : text };
    })
    .filter(({ message }) => !wanted || message.toLowerCase().includes(wanted))
    .reverse();
};

const toSlowQueries = (raw: readonly RawDatabaseLogLine[], sensitive: boolean) =>
  raw
    .flatMap(({ id, time, instance, message }) => {
      const slow = parseSlowQuery(parsePostgresLine(message).text);
      return slow
        ? [
            {
              id,
              time,
              instance,
              durationMs: slow.durationMs,
              statement: sensitive ? slow.statement : hideStatementValues(slow.statement),
            },
          ]
        : [];
    })
    .reverse();

/** A database's busiest statements and its log, read from AWS when someone looks. Nothing is stored. */
@Injectable()
export class DatabaseActivityService {
  constructor(private readonly reads: LogReads) {}

  async topSql(auth: AuthContext, id: string, range: string, ip: string | undefined): Promise<TopSqlView> {
    const minutes = rangeMinutes(range);
    const start = await this.reads.start(auth, id, supportsActivity, ip);
    if (start.kind === 'blocked') {
      return { access: start.access, problem: start.problem, instances: [] };
    }
    const until = new Date();
    try {
      const instances = await this.source(start.target).topSql(
        contextOf(start.target),
        new Date(until.getTime() - minutes * MS_PER_MINUTE),
        until,
      );
      return { access: ALLOWED, problem: null, instances };
    } catch (error) {
      return { access: ALLOWED, problem: this.reads.problemOf(error), instances: [] };
    }
  }

  async log(
    auth: AuthContext,
    id: string,
    query: { since: Date; level: DatabaseLogLevel; search?: string | undefined },
    ip: string | undefined,
  ): Promise<DatabaseLogView> {
    const start = await this.reads.start(auth, id, supportsActivity, ip);
    if (start.kind === 'blocked') {
      return {
        access: start.access,
        problem: start.problem,
        lines: [],
        slowQueries: [],
        partial: false,
        showsValues: false,
      };
    }
    const { target } = start;
    const until = new Date();
    const since = new Date(Math.max(query.since.getTime(), until.getTime() - LOG_RANGE_MINUTES * MS_PER_MINUTE));
    const source = this.source(target);
    const context = contextOf(target);
    try {
      const [main, slow] = await Promise.all([
        source.log(context, { since, until, level: query.level }),
        source.log(context, { since, until, level: 'slow' }),
      ]);
      return {
        access: ALLOWED,
        problem: null,
        lines: toLines(main.lines, query.search, target.sensitive),
        slowQueries: toSlowQueries(slow.lines, target.sensitive),
        partial: main.partial,
        showsValues: target.sensitive,
      };
    } catch (error) {
      return {
        access: ALLOWED,
        problem: this.reads.problemOf(error),
        lines: [],
        slowQueries: [],
        partial: false,
        showsValues: target.sensitive,
      };
    }
  }

  private source({ provider }: LogReadTarget): DatabaseActivitySource {
    const source = provider.databaseActivitySource;
    if (!source) {
      throw new BadRequestException("This resource doesn't have query activity.");
    }
    return source;
  }
}
