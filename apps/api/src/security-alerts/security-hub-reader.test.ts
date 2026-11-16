import { GetFindingsCommand, SecurityHubClient } from '@aws-sdk/client-securityhub';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, describe, expect, it } from 'vitest';
import { loadSecurityAlertsSettings } from './security-alerts.settings';
import { SecurityHubReader } from './security-hub-reader';

const securityHub = mockClient(SecurityHubClient);

const reader = (regions = 'eu-central-1') =>
  new SecurityHubReader(
    (region) => new SecurityHubClient({ region, credentials: { accessKeyId: 'test', secretAccessKey: 'test' } }),
    loadSecurityAlertsSettings({
      SECURITY_ALERTS_POLL_ROLE_ARN: 'arn:aws:iam::040496249361:role/PulseGridSecurityHubReader',
      SECURITY_ALERTS_POLL_REGIONS: regions,
    }),
  );

describe('SecurityHubReader', () => {
  afterEach(() => securityHub.reset());

  it('asks for changed GuardDuty findings and failed critical checks, following every page', async () => {
    securityHub
      .on(GetFindingsCommand)
      .resolvesOnce({ Findings: [{ Id: 'a' } as never], NextToken: 'next' })
      .resolvesOnce({ Findings: [{ Id: 'b' } as never] })
      .resolves({ Findings: [{ Id: 'c' } as never] });

    const since = new Date('2026-11-16T10:00:00Z');
    const findings = await reader().updatedSince(since);

    expect(findings).toHaveLength(3);
    const filters = securityHub.commandCalls(GetFindingsCommand).map(({ args }) => args[0].input.Filters);
    expect(filters[0]).toMatchObject({
      ProductName: [{ Value: 'GuardDuty', Comparison: 'EQUALS' }],
      SeverityLabel: [
        { Value: 'HIGH', Comparison: 'EQUALS' },
        { Value: 'CRITICAL', Comparison: 'EQUALS' },
      ],
      UpdatedAt: [{ Start: '2026-11-16T10:00:00.000Z' }],
    });
    expect(filters).toContainEqual(
      expect.objectContaining({
        ProductName: [{ Value: 'Security Hub', Comparison: 'EQUALS' }],
        ComplianceStatus: [{ Value: 'FAILED', Comparison: 'EQUALS' }],
      }),
    );
  });

  it('asks every region', async () => {
    securityHub.on(GetFindingsCommand).resolves({ Findings: [{ Id: 'x' } as never] });
    expect(await reader('eu-central-1, eu-west-1').updatedSince(new Date())).toHaveLength(4);
  });

  it('looks open findings up by ID, 20 at a time, whatever their state', async () => {
    securityHub.on(GetFindingsCommand).resolves({ Findings: [] });
    const ids = Array.from({ length: 45 }, (_, index) => `finding-${index}`);
    await reader().byIds(ids);
    const calls = securityHub.commandCalls(GetFindingsCommand).map(({ args }) => args[0].input.Filters ?? {});
    expect(calls.map((filters) => filters.Id?.length)).toEqual([20, 20, 5]);
    expect(calls.every((filters) => !filters.ComplianceStatus && !filters.SeverityLabel)).toBe(true);
  });

  it('asks nothing when there are no open alerts', async () => {
    expect(await reader().byIds([])).toEqual([]);
    expect(securityHub.commandCalls(GetFindingsCommand)).toHaveLength(0);
  });
});
