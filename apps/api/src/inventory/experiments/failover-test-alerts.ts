import { Injectable } from '@nestjs/common';
import { type ExperimentState, type TestHistoryEntry, testResult } from '@pulsegrid/shared';
import { TenantDatabase } from '../../database/tenant-database';
import { PushNotifier } from '../../push/push-notifier';

export interface FinishedTest {
  id: string;
  label: string;
  state: ExperimentState;
  reason: string | null;
  startedByEmail: string | null;
}

const RESULT_WORDS = { passed: 'passed', failed: 'failed', stopped: 'was stopped' } as const;

/** Tells the person who started a failover test, or a group run of them, how it ended. */
@Injectable()
export class FailoverTestAlerts {
  constructor(
    private readonly database: TenantDatabase,
    private readonly push: PushNotifier,
  ) {}

  async testFinished(tenantId: string, test: FinishedTest): Promise<void> {
    const result = testResult(test.state) ?? 'failed';
    await this.tell(tenantId, test.startedByEmail, {
      title: `Failover test ${RESULT_WORDS[result]}`,
      body: result === 'passed' || !test.reason ? test.label : `${test.label}: ${test.reason}`,
      path: `/failover-tests/tests/${test.id}`,
      collapseId: `failover-${test.id}`,
    });
  }

  async runFinished(tenantId: string, run: TestHistoryEntry): Promise<void> {
    const counts = run.counts;
    const parts = counts
      ? [
          `${counts.passed} of ${counts.total} passed`,
          counts.failed && `${counts.failed} failed`,
          counts.stopped && `${counts.stopped} stopped`,
          counts.notStarted && `${counts.notStarted} didn't start`,
        ]
      : ['Finished'];
    await this.tell(tenantId, run.startedBy, {
      title: `${run.label} finished`,
      body: parts.filter(Boolean).join(', '),
      path: `/failover-tests/runs/${run.accountId}/${run.id}`,
      collapseId: `failover-run-${run.id}`,
    });
  }

  private async tell(tenantId: string, email: string | null, message: Parameters<PushNotifier['toUser']>[3]): Promise<void> {
    if (!email) return;
    const user = await this.database.run(tenantId, (trx) =>
      trx.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst(),
    );
    if (user) this.push.toUser(tenantId, user.id, 'failover_tests', message);
  }
}
