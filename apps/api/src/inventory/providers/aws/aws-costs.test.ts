import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { AWS_COST_SOURCE } from './aws-costs';

const client = mockClient(CostExplorerClient);
const context = { credentials: { accessKeyId: 'a', secretAccessKey: 'b' }, accountId: '500000000000' };
const period = { from: new Date('2026-10-01T00:00:00Z'), until: new Date('2026-11-07T00:00:00Z') };

const group = (name: string, amount: string) => ({
  Keys: [name],
  Metrics: { UnblendedCost: { Amount: amount, Unit: 'USD' } },
});
const month = (start: string, groups: ReturnType<typeof group>[]) => ({
  TimePeriod: { Start: start, End: start },
  Groups: groups,
});

describe('AWS costs', () => {
  beforeEach(() => client.reset());

  it('asks for one account, by service and month', async () => {
    client.on(GetCostAndUsageCommand).resolves({ ResultsByTime: [] });
    await AWS_COST_SOURCE.read(context, period);
    expect(client.commandCalls(GetCostAndUsageCommand)[0]!.args[0].input).toMatchObject({
      TimePeriod: { Start: '2026-10-01', End: '2026-11-07' },
      Granularity: 'MONTHLY',
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: ['500000000000'] } },
    });
  });

  it('puts the two EC2 lines together and keeps other services by name', async () => {
    client.on(GetCostAndUsageCommand).resolves({
      ResultsByTime: [
        month('2026-11-01', [
          group('Amazon Elastic Compute Cloud - Compute', '10.5'),
          group('EC2 - Other', '2.5'),
          group('AmazonCloudWatch', '1'),
        ]),
      ],
    });
    expect(await AWS_COST_SOURCE.read(context, period)).toEqual([
      { month: '2026-11', service: 'EC2', category: 'ec2', amount: 13, currency: 'USD' },
      { month: '2026-11', service: 'AmazonCloudWatch', category: null, amount: 1, currency: 'USD' },
    ]);
  });

  it('reads every page, keeping services that span pages', async () => {
    client
      .on(GetCostAndUsageCommand)
      .resolvesOnce({
        NextPageToken: 'next',
        ResultsByTime: [month('2026-11-01', [group('EC2 - Other', '1')])],
      })
      .resolves({
        ResultsByTime: [month('2026-11-01', [group('Amazon Elastic Compute Cloud - Compute', '2')])],
      });
    expect(await AWS_COST_SOURCE.read(context, period)).toEqual([
      { month: '2026-11', service: 'EC2', category: 'ec2', amount: 3, currency: 'USD' },
    ]);
    expect(client.commandCalls(GetCostAndUsageCommand)).toHaveLength(2);
  });

  it('turns AWS errors into readable messages', () => {
    const named = (name: string) => Object.assign(new Error('raw'), { name });
    expect(AWS_COST_SOURCE.failureMessage(named('AccessDeniedException'))).toContain('ce:GetCostAndUsage');
    expect(AWS_COST_SOURCE.failureMessage(named('DataUnavailableException'))).toContain('yet');
    expect(AWS_COST_SOURCE.failureMessage(named('Other'))).not.toContain('raw');
  });
});
