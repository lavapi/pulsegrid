import type { TenantTransaction } from '../../database/tenant-context';

export const STARTED_ACTION = 'cloud.experiment.started';
export const STOPPED_ACTION = 'cloud.experiment.stopped';

/** Who started a test from PulseGrid, or null when it was started elsewhere. */
export const startedBy = async (trx: TenantTransaction, experimentId: string): Promise<string | null> => {
  const event = await trx
    .selectFrom('audit_events')
    .select('actor_email')
    .where('action', '=', STARTED_ACTION)
    .where('target_id', '=', experimentId)
    .executeTakeFirst();
  return event?.actor_email ?? null;
};
