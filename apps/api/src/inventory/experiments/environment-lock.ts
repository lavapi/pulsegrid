import { isActiveExperiment } from '@pulsegrid/shared';
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { CloudAccountRow } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';
import { CredentialVault } from '../connection/credential-vault';
import { ProviderRegistry } from '../providers/provider-registry';

/** Every account of the environment shares one lock; an account with no environment has its own. */
const lockKey = ({ environment_id: environmentId, id }: Pick<CloudAccountRow, 'environment_id' | 'id'>): string =>
  `failover:${environmentId ?? id}`;

/**
 * Only one failover test runs at a time in an environment, whoever started it and from where: a run, a single test,
 * or an experiment started outside PulseGrid.
 */
@Injectable()
export class EnvironmentLock {
  constructor(
    private readonly providers: ProviderRegistry,
    private readonly vault: CredentialVault,
  ) {}

  /** Holds the environment's lock until the transaction ends, so two starts can't both see it free. */
  async hold(trx: TenantTransaction, account: Pick<CloudAccountRow, 'environment_id' | 'id'>): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${lockKey(account)}, 0))`.execute(trx);
  }

  /** What's running in the environment, in plain words, or null when it's free. */
  async busy(trx: TenantTransaction, account: CloudAccountRow, exceptRunId?: string): Promise<string | null> {
    const accounts = account.environment_id
      ? await trx.selectFrom('cloud_accounts').selectAll().where('environment_id', '=', account.environment_id).execute()
      : [account];
    let runs = trx
      .selectFrom('experiment_runs')
      .select('label')
      .where(
        'cloud_account_id',
        'in',
        accounts.map(({ id }) => id),
      )
      .where(sql<boolean>`items @> ${JSON.stringify([{ settling: true }])}::jsonb`);
    if (exceptRunId) {
      runs = runs.where('id', '!=', exceptRunId);
    }
    const run = await runs.executeTakeFirst();
    if (run) {
      return `The run "${run.label}" is running a test in this environment.`;
    }
    for (const other of accounts) {
      const running = await this.runningInAws(other);
      if (running) {
        return running;
      }
    }
    return null;
  }

  private async runningInAws(account: CloudAccountRow): Promise<string | null> {
    const source = this.providers.get(account.provider).experimentSource;
    const credentials = this.vault.open(account);
    if (!source || !credentials) {
      return null;
    }
    for (const region of account.regions) {
      try {
        const experiments = await source.listExperiments({ credentials, region });
        const active = experiments.find(({ state }) => isActiveExperiment(state));
        if (active) {
          return `Experiment ${active.id} is running in ${account.name}.`;
        }
      } catch {
        continue;
      }
    }
    return null;
  }
}
