import { connectGuide, guideAsText, guideForSlack } from '@pulsegrid/shared';
import { describe, expect, it } from 'vitest';

const connect = {
  ssoStartUrl: 'https://example.awsapps.com/start',
  ssoRegion: 'eu-west-1',
  profile: 'production-db',
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
const grant = { userName: 'pat_ops@example.com', expiresAt: '2026-11-13T15:37:00.000Z' };
const guide = connectGuide(connect, grant);
const steps = guide.sections.flatMap(({ steps: list }) => list);

describe('connectGuide', () => {
  it('says who it is for and until when, in UTC', () => {
    expect(guide.intro).toBe('Access for pat_ops@example.com until 13 Nov, 15:37 UTC.');
  });

  it('builds the AWS config with the SSO region and profile', () => {
    const config = steps.find(({ title }) => title === 'Add this to ~/.aws/config')?.code ?? '';
    expect(config).toContain('sso_start_url = https://example.awsapps.com/start\nsso_region = eu-west-1');
    expect(config).toContain(
      '[profile production-db]\nsso_session = pulsegrid-db-access\nsso_account_id = 111111111111\nsso_role_name = ProductionDatabaseReadOnly\nregion = eu-central-1',
    );
  });

  it('runs every command with the profile, through the tunnel to the reader endpoint', () => {
    const commands = steps.flatMap(({ code }) => (code?.startsWith('aws ') ? [code] : []));
    expect(commands).toHaveLength(3);
    expect(commands.every((command) => command.includes('--profile production-db'))).toBe(true);
    expect(commands[1]).toContain(
      '--target i-0abc --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=db.cluster-ro-x.eu-central-1.rds.amazonaws.com,portNumber=5432,localPortNumber=15432',
    );
    expect(commands[2]).toContain('--username readonly_access --region eu-central-1');
  });

  it('lists the client settings', () => {
    const fields = steps.find(({ fields: list }) => list)?.fields;
    expect(Object.fromEntries((fields ?? []).map(({ label, value }) => [label, value]))).toMatchObject({
      Host: 'localhost',
      Port: '15432',
      Database: 'game',
      User: 'readonly_access',
      'SSL mode': 'require',
    });
  });
});

describe('sharing the guide', () => {
  it('formats it for Slack with bold headings, numbered steps and code blocks', () => {
    const slack = guideForSlack(guide);
    expect(
      slack.startsWith('*Connecting to the production database (read-only)*\nAccess for pat_ops@example.com'),
    ).toBe(true);
    expect(slack).toContain('*One-time setup*\n1. Install the tools');
    expect(slack).toContain('*Each time you connect*\n3. Sign in');
    expect(slack).toContain('```\naws sso login --profile production-db\n```');
    expect(slack).toContain('• Port: 15432');
  });

  it('gives a plain version without Slack bold marks for other messengers', () => {
    const text = guideAsText(guide);
    expect(text.startsWith('Connecting to the production database (read-only)\n')).toBe(true);
    expect(text).not.toMatch(/^\*/m);
    expect(text).toContain('```\naws sso login --profile production-db\n```');
  });
});
