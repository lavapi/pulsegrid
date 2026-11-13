import { GetScheduleCommand, ListSchedulesCommand, SchedulerClient } from '@aws-sdk/client-scheduler';
import { DescribeExecutionCommand, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import type { AwsKey } from '../inventory/providers/aws/aws-key';
import { DatabaseAccessError, MESSAGES, readable, workflowFailure } from './database-access-errors';
import type { DatabaseAccessSettings } from './database-access.settings';

const RUNNING = 'RUNNING';
const PENDING_REDRIVE = 'PENDING_REDRIVE';
const SUCCEEDED = 'SUCCEEDED';
const SCHEDULE_PREFIX = 'db-access-';
const AT = /^at\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\)$/;

export interface PollOptions {
  intervalMs: number;
  timeoutMs: number;
}

export const DEFAULT_POLL: PollOptions = { intervalMs: 2000, timeoutMs: 10 * 60_000 };

export interface GrantOutput {
  userName: string;
  userId: string;
  expiresAt: string;
}

export interface RevokeOutput {
  userName: string;
  userId: string;
  signInsStopped: boolean;
}

/** How a workflow run ended: its output, or a readable reason it failed. */
export type RunResult<Output> = { ok: true; output: Output } | { ok: false; failure: string };

export interface ScheduledExpiry {
  userId: string;
  expiresAt: string | null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseOutput = <Output>(output: string | undefined): Output | null => {
  try {
    return output ? (JSON.parse(output) as Output) : null;
  } catch {
    return null;
  }
};

/** The expiry in a schedule's one-time expression, such as at(2026-11-13T18:30:00) read in UTC. */
export const expiryOf = (expression: string | undefined, timezone: string | undefined): string | null => {
  const match = expression ? AT.exec(expression) : null;
  if (!match || (timezone && timezone !== 'UTC')) {
    return null;
  }
  return new Date(`${match[1]}Z`).toISOString();
};

/**
 * Starts and follows the two AWS workflows that own every step of database access, with the Production account's
 * key. Also reads the expiry schedules the grant workflow makes, but never changes them.
 */
export class DatabaseAccessWorkflows {
  private readonly sfn: SFNClient;
  private readonly scheduler: SchedulerClient;

  constructor(
    private readonly settings: DatabaseAccessSettings,
    credentials: AwsKey,
    private readonly poll: PollOptions = DEFAULT_POLL,
  ) {
    const config = { region: settings.region, credentials };
    this.sfn = new SFNClient(config);
    this.scheduler = new SchedulerClient(config);
  }

  /** Starts a grant, or an extension when the person already has access; returns the run to follow. */
  startGrant(userName: string, expiresAt: Date): Promise<string> {
    return this.start(this.settings.grantStateMachineArn, { userName, expiresAt: expiresAt.toISOString() });
  }

  startRevoke(userName: string): Promise<string> {
    return this.start(this.settings.revokeStateMachineArn, { userName });
  }

  /** Checks a run every 2 seconds until it ends. A run that doesn't end in time asks to try again. */
  async follow<Output>(executionArn: string): Promise<RunResult<Output>> {
    const deadline = Date.now() + this.poll.timeoutMs;
    for (;;) {
      let execution;
      try {
        execution = await this.sfn.send(new DescribeExecutionCommand({ executionArn }));
      } catch (error) {
        return { ok: false, failure: readable(error).message };
      }
      if (execution.status !== RUNNING && execution.status !== PENDING_REDRIVE) {
        const output = parseOutput<Output>(execution.output);
        return execution.status === SUCCEEDED && output
          ? { ok: true, output }
          : { ok: false, failure: workflowFailure(execution.error) };
      }
      if (Date.now() >= deadline) {
        return { ok: false, failure: MESSAGES.retry };
      }
      await sleep(this.poll.intervalMs);
    }
  }

  /** Who has an expiry schedule, and when it ends: everyone with access in AWS, granted here or not. */
  async scheduledExpiries(): Promise<ScheduledExpiry[]> {
    const names: string[] = [];
    let token: string | undefined;
    try {
      do {
        const page = await this.scheduler.send(
          new ListSchedulesCommand({
            GroupName: this.settings.scheduleGroup,
            NamePrefix: SCHEDULE_PREFIX,
            NextToken: token,
          }),
        );
        names.push(...(page.Schedules ?? []).flatMap(({ Name }) => Name ?? []));
        token = page.NextToken;
      } while (token);
      const expiries: ScheduledExpiry[] = [];
      for (const name of names) {
        const schedule = await this.scheduler.send(
          new GetScheduleCommand({ Name: name, GroupName: this.settings.scheduleGroup }),
        );
        expiries.push({
          userId: name.slice(SCHEDULE_PREFIX.length),
          expiresAt: expiryOf(schedule.ScheduleExpression, schedule.ScheduleExpressionTimezone),
        });
      }
      return expiries;
    } catch (error) {
      throw readable(error);
    }
  }

  private async start(stateMachineArn: string, input: Record<string, string>): Promise<string> {
    try {
      const { executionArn } = await this.sfn.send(
        new StartExecutionCommand({ stateMachineArn, input: JSON.stringify(input) }),
      );
      if (!executionArn) {
        throw new DatabaseAccessError(MESSAGES.retry);
      }
      return executionArn;
    } catch (error) {
      throw readable(error);
    }
  }
}
