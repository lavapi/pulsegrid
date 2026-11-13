import { describe, expect, it } from 'vitest';
import { connectSteps, endingOf, progressOf, timeLeft } from './database-access';

const connect = {
  ssoStartUrl: 'https://example.awsapps.com/start',
  accountId: '111111111111',
  roleName: 'ProductionDatabaseReadOnly',
  region: 'eu-central-1',
  tunnelInstanceId: 'i-0abc',
  readerEndpoint: 'db.cluster-ro-x.eu-central-1.rds.amazonaws.com',
  port: 5432,
  localPort: 15432,
  database: 'game',
  user: 'readonly_access',
};

describe('timeLeft', () => {
  const now = Date.parse('2026-11-13T10:00:00Z');

  it('shows hours and minutes, then minutes, then nothing once ended', () => {
    expect(timeLeft('2026-11-13T12:05:00Z', now)).toBe('2 h 05 min');
    expect(timeLeft('2026-11-13T10:04:10Z', now)).toBe('5 min');
    expect(timeLeft('2026-11-13T09:59:00Z', now)).toBeNull();
  });
});

describe('connectSteps', () => {
  it('builds the tunnel and token commands from the settings', () => {
    const steps = connectSteps(connect);
    expect(steps.map(({ title }) => title)).toHaveLength(4);
    expect(steps[1]?.command).toContain(
      '--target i-0abc --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=db.cluster-ro-x.eu-central-1.rds.amazonaws.com,portNumber=5432,localPortNumber=15432',
    );
    expect(steps[2]?.command).toContain('--username readonly_access --region eu-central-1');
    expect(steps[3]?.text).toContain('port 15432, database game, user readonly_access');
  });
});

describe('grant states', () => {
  const grant = {
    id: 'g',
    grantedBy: 'gus@example.test',
    userName: 'pat@example.test',
    userId: 'u1',
    reason: 'Check',
    status: 'active' as const,
    change: null,
    failure: null,
    startsAt: '2026-11-13T10:00:00Z',
    expiresAt: '2026-11-13T12:00:00Z',
    revokedAt: null,
    revokedBy: null,
    endReason: null,
  };

  it('says what AWS is doing, and how a grant ended', () => {
    expect(progressOf({ ...grant, status: 'granting' })).toBe('Granting in AWS, usually 1 to 2 minutes');
    expect(progressOf({ ...grant, change: 'revoking' })).toBe('Revoking in AWS');
    expect(progressOf(grant)).toBeNull();
    expect(endingOf({ ...grant, status: 'revoked', endReason: 'manual', revokedBy: 'gus@example.test' })).toBe(
      'Revoked by gus@example.test',
    );
    expect(endingOf({ ...grant, status: 'expired', endReason: 'expired' })).toBe('Expired');
    expect(endingOf({ ...grant, status: 'failed', failure: 'Not allowed.' })).toBe('Failed: Not allowed.');
  });
});
