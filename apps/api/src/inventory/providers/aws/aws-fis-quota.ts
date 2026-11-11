import { paginateListServiceQuotas, ServiceQuotasClient } from '@aws-sdk/client-service-quotas';
import { DEFAULT_EXPERIMENT_QUOTA } from '@pulsegrid/shared';
import type { ConcurrencyLimit, ExperimentContext } from '../provider';
import type { AwsKey } from './aws-key';

const FIS_SERVICE = 'fis';
const ACTIVE_EXPERIMENTS = /active experiments|concurrent(ly)? .*experiments/i;
const QUOTA_TTL_MS = 60 * 60_000;
const DEFAULT_LIMIT: ConcurrencyLimit = { limit: DEFAULT_EXPERIMENT_QUOTA, known: false };

const cache = new Map<string, { value: ConcurrencyLimit; until: number }>();

/** The account's quota on FIS experiments running at once in a region, kept for an hour because raising it takes days. */
export const fisConcurrencyLimit = async (
  { credentials, region }: ExperimentContext<AwsKey>,
  now = Date.now(),
): Promise<ConcurrencyLimit> => {
  const key = `${credentials.accessKeyId}/${region}`;
  const cached = cache.get(key);
  if (cached && cached.until > now) {
    return cached.value;
  }
  try {
    const pages = paginateListServiceQuotas(
      { client: new ServiceQuotasClient({ region, credentials }) },
      { ServiceCode: FIS_SERVICE },
    );
    let value = DEFAULT_LIMIT;
    for await (const { Quotas = [] } of pages) {
      const quota = Quotas.find(({ QuotaName }) => ACTIVE_EXPERIMENTS.test(QuotaName ?? ''));
      if (quota?.Value) {
        value = { limit: Math.floor(quota.Value), known: true };
        break;
      }
    }
    cache.set(key, { value, until: now + QUOTA_TTL_MS });
    return value;
  } catch {
    return DEFAULT_LIMIT;
  }
};
