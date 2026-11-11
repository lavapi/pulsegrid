import { ListServiceQuotasCommand, ServiceQuotasClient } from '@aws-sdk/client-service-quotas';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { fisConcurrencyLimit } from './aws-fis-quota';

const quotas = mockClient(ServiceQuotasClient);
const context = (accessKeyId: string) => ({
  credentials: { accessKeyId, secretAccessKey: 'b' },
  region: 'eu-central-1',
});

beforeEach(() => quotas.reset());

describe('fisConcurrencyLimit', () => {
  it('reads the active experiments quota, across pages, and keeps it for an hour', async () => {
    quotas
      .on(ListServiceQuotasCommand)
      .resolvesOnce({ Quotas: [{ QuotaName: 'Experiment templates', Value: 500 }], NextToken: 'next' })
      .resolvesOnce({ Quotas: [{ QuotaName: 'Active experiments', Value: 10 }] });
    expect(await fisConcurrencyLimit(context('A1'), 0)).toEqual({ limit: 10, known: true });
    expect(await fisConcurrencyLimit(context('A1'), 1000)).toEqual({ limit: 10, known: true });
    expect(quotas.commandCalls(ListServiceQuotasCommand)).toHaveLength(2);
  });

  it("assumes AWS's default of 5 when the quota can't be read", async () => {
    quotas.on(ListServiceQuotasCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDeniedException' }));
    expect(await fisConcurrencyLimit(context('A2'))).toEqual({ limit: 5, known: false });
  });
});
