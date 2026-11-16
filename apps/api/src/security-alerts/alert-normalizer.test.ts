import { describe, expect, it } from 'vitest';
import { normalizeEvent } from './alert-normalizer';
import { fixtureEvent } from './fixtures/sns-fixtures';

const receivedAt = new Date('2026-11-16T10:00:00Z');
const normalize = (event: unknown) => normalizeEvent(JSON.stringify(event), receivedAt);

describe('normalizeEvent', () => {
  it('makes one alert per Security Hub finding', () => {
    const [guardDuty, control] = normalize(fixtureEvent('security-hub-two-findings')) ?? [];

    expect(guardDuty).toMatchObject({
      key: 'arn:aws:guardduty:eu-central-1:860922939595:detector/b2c6d5e1f0a94c3d8e7f6a5b4c3d2e1f/finding/34c6d5e1f0a94c3d8e7f6a5b4c3d2e10',
      source: 'guardduty',
      severity: 'HIGH',
      accountId: '860922939595',
      region: 'eu-central-1',
      occurredAt: new Date('2026-11-16T09:02:05.512Z'),
      updatedAt: new Date('2026-11-16T09:13:01.004Z'),
      consoleUrl:
        'https://eu-central-1.console.aws.amazon.com/guardduty/home?region=eu-central-1#/findings?fId=34c6d5e1f0a94c3d8e7f6a5b4c3d2e10',
      facts: {
        workflowStatus: 'NEW',
        recordState: 'ACTIVE',
        resourceIds: ['arn:aws:ec2:eu-central-1:860922939595:instance/i-0a1b2c3d4e5f60718'],
      },
    });
    expect(guardDuty?.title).toContain('command and control server');

    expect(control).toMatchObject({
      source: 'securityhub',
      severity: 'CRITICAL',
      title: 'IAM.6 Hardware MFA should be enabled for the root user',
      accountId: '121017505984',
      facts: { complianceStatus: 'FAILED', resourceIds: ['AWS::::Account:121017505984'] },
    });
    expect(control?.consoleUrl).toMatch(/^https:\/\/eu-central-1\.console\.aws\.amazon\.com\/securityhub\/home/);
    expect(control?.rawEvent).toEqual(fixtureEvent('security-hub-two-findings'));
  });

  it('makes a critical alert of a root console sign-in', () => {
    expect(normalize(fixtureEvent('root-console-login'))).toEqual([
      {
        key: 'c2a5f6e1-7d3b-48a9-b0f4-91e2d7c6a3b8',
        source: 'root-activity',
        severity: 'CRITICAL',
        title: 'Root user signed in to the console (Success)',
        accountId: '768807471283',
        region: 'us-east-1',
        occurredAt: new Date('2026-11-16T10:04:09Z'),
        updatedAt: new Date('2026-11-16T10:04:09Z'),
        consoleUrl:
          'https://us-east-1.console.aws.amazon.com/cloudtrailv2/home?region=us-east-1#/events/3f0b1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
        facts: {
          eventName: 'ConsoleLogin',
          sourceIpAddress: '198.51.100.23',
          userAgent: expect.stringContaining('Safari') as string,
          consoleLogin: 'Success',
        },
        rawEvent: fixtureEvent('root-console-login'),
      },
    ]);
  });

  it('titles other root calls with the action', () => {
    const event = fixtureEvent('root-console-login');
    const detail = { ...(event.detail as object), eventName: 'DeleteTrail', responseElements: null };
    const [alert] = normalize({ ...event, 'detail-type': 'AWS API Call via CloudTrail', detail }) ?? [];
    expect(alert).toMatchObject({ title: 'Root user called DeleteTrail', severity: 'CRITICAL', source: 'root-activity' });
  });

  it('keeps any other event as an informational alert', () => {
    const [alert] =
      normalize({ id: 'e-1', 'detail-type': 'IAM Access Analyzer Finding', account: '040496249361', region: 'eu-central-1', detail: {} }) ?? [];
    expect(alert).toMatchObject({ key: 'e-1', source: 'other', severity: 'INFORMATIONAL', title: 'IAM Access Analyzer Finding' });
  });

  it('treats a CloudTrail event from a non-root user as other', () => {
    const event = fixtureEvent('root-console-login');
    const detail = { ...(event.detail as object), userIdentity: { type: 'IAMUser' } };
    expect(normalize({ ...event, detail })?.[0]?.source).toBe('other');
  });

  it('returns null for text that is not an EventBridge event', () => {
    expect(normalizeEvent('not json')).toBeNull();
    expect(normalizeEvent('{"hello":"world"}')).toBeNull();
  });
});
